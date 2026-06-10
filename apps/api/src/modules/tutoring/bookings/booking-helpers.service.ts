/**
 * BookingHelpersService — port từ apps/web/src/lib/tutoring/booking-helpers.ts:
 * slot validate + study group auto-create + cached counter tutor_profile.
 *
 * Bẫy giữ NGUYÊN khi port:
 *  - isSlotInAvailability dùng Date#getDay/getHours theo TZ LOCAL của server
 *    (so với cột text HH:MM weekly) — đổi TZ semantics là lệch lịch rảnh.
 *  - hasConflictBooking overlap bằng lte/gte INCLUSIVE — slot chạm mép vẫn
 *    tính conflict (y bản cũ).
 *  - refreshTutorStats CHỈ đếm review hidden_at IS NULL (khác bản cron
 *    tutoring-auto-complete cố ý không filter).
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import { generateInviteCode } from '../../groups/group-code';

export type CancelPolicy = {
  allowed: boolean;
  /** Phí phạt VND nếu huỷ — V2 chỉ flag, chưa charge thực. */
  penaltyVnd: number;
  reason: string;
};

/**
 * Plan §8.1: huỷ trước 24h free. Huỷ trong 24h → flag charge 10% (V2 stub).
 */
export function evaluateCancelPolicy(
  startAt: Date,
  rateVnd: number,
  now: Date = new Date(),
): CancelPolicy {
  const hoursUntil = (startAt.getTime() - now.getTime()) / (60 * 60 * 1000);
  if (hoursUntil > 24) {
    return { allowed: true, penaltyVnd: 0, reason: 'Huỷ trước 24h — miễn phí' };
  }
  if (hoursUntil > 0) {
    return {
      allowed: true,
      penaltyVnd: Math.round(rateVnd * 0.1),
      reason: 'Huỷ trong 24h — phí 10% (sẽ trừ trên payment khi V3 active)',
    };
  }
  return { allowed: false, penaltyVnd: 0, reason: 'Buổi học đã bắt đầu — không huỷ được' };
}

export type AutoGroupResult = {
  groupId: string;
  textChannelId: string;
  voiceChannelId: string;
};

@Injectable()
export class BookingHelpersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Kiểm tra time slot có khớp với 1 availability weekly của tutor không.
   * VD: tutor available Mon 19:00-21:00, slot Mon 19:30-20:30 → OK.
   * Slot phải nằm hoàn toàn trong 1 availability window cùng ngày trong tuần.
   */
  async isSlotInAvailability(tutorId: string, startAt: Date, endAt: Date): Promise<boolean> {
    const day = startAt.getDay(); // 0..6
    const slots = await this.prisma.tutor_availability.findMany({
      where: { tutor_id: tutorId, day_of_week: day },
      select: { start_time: true, end_time: true },
    });

    if (slots.length === 0) return false;

    const fmt = (d: Date) => {
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    };
    const start = fmt(startAt);
    const end = fmt(endAt);

    return slots.some((s) => s.start_time <= start && s.end_time >= end);
  }

  /**
   * Kiểm tra tutor có bị double-book không — booking khác overlap với
   * [startAt, endAt] và status còn active (PENDING_TUTOR/CONFIRMED/IN_PROGRESS).
   * Pass `excludeBookingId` nếu update 1 booking sẵn — không tự conflict.
   */
  async hasConflictBooking(
    tutorId: string,
    startAt: Date,
    endAt: Date,
    excludeBookingId?: string,
  ): Promise<boolean> {
    const conflict = await this.prisma.tutoring_booking.findFirst({
      where: {
        tutor_id: tutorId,
        status: { in: ['PENDING_TUTOR', 'CONFIRMED', 'IN_PROGRESS'] },
        // Overlap: existing.startAt <= new.endAt AND existing.endAt >= new.startAt
        start_at: { lte: endAt },
        end_at: { gte: startAt },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      select: { id: true },
    });
    return Boolean(conflict);
  }

  /**
   * Tạo study group cho cặp tutor + student trong transaction confirm. 3 channel:
   * TEXT #chung / VOICE #phòng-học (livekitRoomName='tutoring:{bookingId}') /
   * FORUM #q-a. Members: tutor=OWNER, student=MEMBER, isPublic=false.
   *
   * Plan §7.2: group KHÔNG xoá khi booking COMPLETED — student lưu transcript.
   */
  async autoCreateBookingGroup(
    tx: Prisma.TransactionClient,
    params: {
      bookingId: string;
      tutorUserId: string;
      studentUserId: string;
      subjectName: string;
    },
  ): Promise<AutoGroupResult> {
    const inviteCode = generateInviteCode();
    const legacyCode = generateInviteCode();

    const groupId = randomUUID();
    await tx.study_group.create({
      data: {
        id: groupId,
        name: `${params.subjectName} · 1-1 Tutoring`,
        description: `Phòng học riêng cho buổi tutoring (booking ${params.bookingId.slice(0, 8)})`,
        owner_user_id: params.tutorUserId,
        invite_code: legacyCode,
        is_public: false,
        max_members: 5, // tutor + student + buffer
      },
    });

    await tx.study_group_member.createMany({
      data: [
        { id: randomUUID(), group_id: groupId, user_id: params.tutorUserId, role: 'OWNER' },
        { id: randomUUID(), group_id: groupId, user_id: params.studentUserId, role: 'MEMBER' },
      ],
    });

    // createMany không returning — sinh id app-side để trả về cho booking flow.
    const textChannelId = randomUUID();
    const voiceChannelId = randomUUID();
    await tx.study_group_channel.createMany({
      data: [
        {
          id: textChannelId,
          group_id: groupId,
          name: 'chung',
          type: 'TEXT',
          position: 0,
          created_by: params.tutorUserId,
          topic: 'Trao đổi trước/sau buổi học',
        },
        {
          id: voiceChannelId,
          group_id: groupId,
          name: 'phòng-học',
          type: 'VOICE',
          position: 1,
          created_by: params.tutorUserId,
          topic: 'Live session — auto recording',
          livekit_room_name: `tutoring:${params.bookingId}`,
        },
        {
          id: randomUUID(),
          group_id: groupId,
          name: 'q-a',
          type: 'FORUM',
          position: 2,
          created_by: params.tutorUserId,
          topic: 'Hỏi đáp ngoài giờ',
        },
      ],
    });

    await tx.study_group_invite.create({
      data: {
        id: randomUUID(),
        group_id: groupId,
        code: inviteCode,
        created_by: params.tutorUserId,
      },
    });

    return { groupId, textChannelId, voiceChannelId };
  }

  /**
   * Recompute rating_avg + rating_count + sessions_completed sau khi insert
   * review / complete booking. Subquery tương quan → giữ raw UPDATE (Prisma
   * client không express được); updated_at lấy app time như bản cũ.
   */
  async refreshTutorStats(tutorId: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE tutor_profile SET
        rating_avg = (
          SELECT round(avg(rating)::numeric, 2)
          FROM tutor_review
          WHERE tutor_review.tutor_id = ${tutorId}
            AND tutor_review.hidden_at IS NULL
        ),
        rating_count = (
          SELECT count(*)::int
          FROM tutor_review
          WHERE tutor_review.tutor_id = ${tutorId}
            AND tutor_review.hidden_at IS NULL
        ),
        sessions_completed = (
          SELECT count(*)::int
          FROM tutoring_booking
          WHERE tutoring_booking.tutor_id = ${tutorId}
            AND tutoring_booking.status = 'COMPLETED'
        ),
        updated_at = ${new Date()}
      WHERE id = ${tutorId}
    `);
  }
}
