/**
 * Booking helpers — slot validate + study group auto-create + counter update.
 *
 * Tách module dùng chung giữa các endpoint:
 *   - POST /api/tutoring/bookings        (create)
 *   - POST /api/tutoring/bookings/[id]/confirm
 *   - POST /api/tutoring/bookings/[id]/cancel
 *   - POST /api/tutoring/bookings/[id]/complete
 *
 * Logic phức tạp tập trung ở đây để API route gọn + dễ test riêng.
 */
import { and, eq, gte, lte, ne, or, sql } from 'drizzle-orm';

import {
  db,
  studyGroup,
  studyGroupChannel,
  studyGroupInvite,
  studyGroupMember,
  tutorAvailability,
  tutorProfile,
  tutorReview,
  tutoringBooking,
  user as userTable,
} from '@cogniva/db';

import { generateInviteCode } from '@/lib/group/code';

// Tx type — dùng parameters của db.transaction callback. Tránh import
// PgTransaction generic vì schema typing phức tạp giữa các re-export.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ──────────────────────────────────────────────────────────
// 1. Slot validation
// ──────────────────────────────────────────────────────────

/**
 * Kiểm tra time slot có khớp với 1 availability weekly của tutor không.
 * VD: tutor available Mon 19:00-21:00, slot Mon 19:30-20:30 → OK.
 * Slot phải nằm hoàn toàn trong 1 availability window cùng ngày trong tuần.
 */
export async function isSlotInAvailability(
  tutorId: string,
  startAt: Date,
  endAt: Date,
): Promise<boolean> {
  const day = startAt.getDay(); // 0..6
  const slots = await db
    .select({
      startTime: tutorAvailability.startTime,
      endTime: tutorAvailability.endTime,
    })
    .from(tutorAvailability)
    .where(
      and(
        eq(tutorAvailability.tutorId, tutorId),
        eq(tutorAvailability.dayOfWeek, day),
      ),
    );

  if (slots.length === 0) return false;

  // Convert startAt/endAt thành "HH:MM" để compare với slot weekly text fields
  const fmt = (d: Date) => {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };
  const start = fmt(startAt);
  const end = fmt(endAt);

  return slots.some((s) => s.startTime <= start && s.endTime >= end);
}

/**
 * Kiểm tra tutor có bị double-book không — có booking khác overlap với
 * [startAt, endAt] và status còn active (PENDING_TUTOR / CONFIRMED /
 * IN_PROGRESS).
 *
 * Pass `excludeBookingId` nếu update 1 booking sẵn — không tự conflict.
 */
export async function hasConflictBooking(
  tutorId: string,
  startAt: Date,
  endAt: Date,
  excludeBookingId?: string,
): Promise<boolean> {
  const conflicts = await db
    .select({ id: tutoringBooking.id })
    .from(tutoringBooking)
    .where(
      and(
        eq(tutoringBooking.tutorId, tutorId),
        // Active status
        or(
          eq(tutoringBooking.status, 'PENDING_TUTOR'),
          eq(tutoringBooking.status, 'CONFIRMED'),
          eq(tutoringBooking.status, 'IN_PROGRESS'),
        ),
        // Overlap: existing.startAt < new.endAt AND existing.endAt > new.startAt
        lte(tutoringBooking.startAt, endAt),
        gte(tutoringBooking.endAt, startAt),
        excludeBookingId
          ? ne(tutoringBooking.id, excludeBookingId)
          : undefined,
      ),
    )
    .limit(1);
  return conflicts.length > 0;
}

// ──────────────────────────────────────────────────────────
// 2. Cancellation policy (24h before startAt)
// ──────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────
// 3. Auto-create study group khi booking confirmed
// ──────────────────────────────────────────────────────────

export type AutoGroupResult = {
  groupId: string;
  textChannelId: string;
  voiceChannelId: string;
};

/**
 * Tạo study group cho tặp tutor + student. Group có 3 channels:
 *   - TEXT  #chung      — trao đổi văn bản
 *   - VOICE #phòng-học  — live session, recording attach vào booking
 *   - FORUM #q-a        — student ask offline, tutor reply
 *
 * Members: tutor=OWNER, student=MEMBER. Group `isPublic=false`.
 *
 * Plan §7.2: group KHÔNG xoá khi booking COMPLETED — student lưu lại
 * transcript + tài liệu để ôn.
 */
export async function autoCreateBookingGroup(
  tx: Tx,
  params: {
    bookingId: string;
    tutorUserId: string;
    studentUserId: string;
    subjectName: string;
  },
): Promise<AutoGroupResult> {
  const inviteCode = generateInviteCode();
  const legacyCode = generateInviteCode();

  const [g] = await tx
    .insert(studyGroup)
    .values({
      name: `${params.subjectName} · 1-1 Tutoring`,
      description: `Phòng học riêng cho buổi tutoring (booking ${params.bookingId.slice(0, 8)})`,
      ownerUserId: params.tutorUserId,
      inviteCode: legacyCode,
      isPublic: false,
      maxMembers: 5, // tutor + student + buffer
    })
    .returning({ id: studyGroup.id });
  if (!g) throw new Error('Auto-create group: insert studyGroup failed');
  const groupId = g.id;

  // Members
  await tx.insert(studyGroupMember).values([
    { groupId, userId: params.tutorUserId, role: 'OWNER' },
    { groupId, userId: params.studentUserId, role: 'MEMBER' },
  ]);

  // Channels — TEXT + VOICE + FORUM
  const channels = await tx
    .insert(studyGroupChannel)
    .values([
      {
        groupId,
        name: 'chung',
        type: 'TEXT',
        position: 0,
        createdBy: params.tutorUserId,
        topic: 'Trao đổi trước/sau buổi học',
      },
      {
        groupId,
        name: 'phòng-học',
        type: 'VOICE',
        position: 1,
        createdBy: params.tutorUserId,
        topic: 'Live session — auto recording',
        livekitRoomName: `tutoring:${params.bookingId}`,
      },
      {
        groupId,
        name: 'q-a',
        type: 'FORUM',
        position: 2,
        createdBy: params.tutorUserId,
        topic: 'Hỏi đáp ngoài giờ',
      },
    ])
    .returning({ id: studyGroupChannel.id, type: studyGroupChannel.type });

  await tx.insert(studyGroupInvite).values({
    groupId,
    code: inviteCode,
    createdBy: params.tutorUserId,
  });

  const text = channels.find((c) => c.type === 'TEXT');
  const voice = channels.find((c) => c.type === 'VOICE');
  if (!text || !voice) throw new Error('Auto-create group: channel insert failed');

  return { groupId, textChannelId: text.id, voiceChannelId: voice.id };
}

// ──────────────────────────────────────────────────────────
// 4. Cached counter — rating + sessions completed
// ──────────────────────────────────────────────────────────

/**
 * Recompute rating_avg + rating_count + sessions_completed sau khi insert
 * review / complete booking. Không dùng trigger để dễ maintain trong app.
 */
export async function refreshTutorStats(tutorId: string): Promise<void> {
  await db
    .update(tutorProfile)
    .set({
      // Phase 4: cache ratingAvg/Count chỉ tính review CHƯA bị admin ẩn —
      // tránh tutor profile show số bị ảnh hưởng bởi review đã hide.
      ratingAvg: sql<string>`(
        SELECT round(avg(rating)::numeric, 2)
        FROM ${tutorReview}
        WHERE ${tutorReview.tutorId} = ${tutorId}
          AND ${tutorReview.hiddenAt} IS NULL
      )`,
      ratingCount: sql<number>`(
        SELECT count(*)::int
        FROM ${tutorReview}
        WHERE ${tutorReview.tutorId} = ${tutorId}
          AND ${tutorReview.hiddenAt} IS NULL
      )`,
      sessionsCompleted: sql<number>`(
        SELECT count(*)::int
        FROM ${tutoringBooking}
        WHERE ${tutoringBooking.tutorId} = ${tutorId}
          AND ${tutoringBooking.status} = 'COMPLETED'
      )`,
      updatedAt: new Date(),
    })
    .where(eq(tutorProfile.id, tutorId));
}

// ──────────────────────────────────────────────────────────
// 5. Tutor + student user lookup cho auto-create
// ──────────────────────────────────────────────────────────

export async function getTutorUserId(tutorId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: tutorProfile.userId })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, tutorId))
    .limit(1);
  return row?.userId ?? null;
}

export async function getStudentName(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.name ?? null;
}
