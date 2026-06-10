/**
 * TutoringBookingsService — MODULE TIỀN, port từng dòng từ
 * apps/web/src/app/api/tutoring/{bookings/**,payments/**,payouts,calendar/me,ical/[token]}.
 *
 * Semantics tiền giữ NGUYÊN bản cũ:
 *  - confirm: transaction (group + booking CONFIRMED + payment STUB auto-CAPTURED).
 *  - cancel: refundPayment gọi NGOÀI transaction (HTTP không giữ lock) — refund
 *    fail thì booking VẪN CANCELLED, payment giữ CAPTURED chờ admin manual.
 *  - complete: escrow_release_at = now + 7 ngày (mốc payout released).
 *  - payouts: released so sánh NOW() phía DB; check withdrawable rồi insert
 *    KHÔNG khoá (race y bản cũ — không tự sửa).
 */
import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { Prisma, type tutor_payout, type tutor_review, type tutoring_booking } from '@prisma/client';
import { z } from 'zod';
import { onTutoringMineChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../../infra/database/prisma.service';
import type { AuthUser } from '../../../common/auth/session.types';
import { PaymentProviderService, type PaymentProviderName } from '../../payments/payment-provider.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SUBJECT_BY_SLUG } from '../../library/subject-taxonomy';
import { BookingHelpersService, evaluateCancelPolicy } from './booking-helpers.service';
import { buildIcsFeed, type IcalEvent } from './ical';

const CREATE_SCHEMA = z.object({
  tutorId: z.string().min(1),
  subjectSlug: z.string().min(1),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  studentMessage: z.string().max(500).optional(),
  /**
   * V4 T2: trial booking — giảm 50% rate, 1 lần / pair (student, tutor).
   * Server enforce qua DB partial unique index + app check.
   */
  isTrial: z.boolean().optional(),
});

export const CANCEL_SCHEMA = z.object({
  reason: z.string().max(500).optional(),
});

export const REVIEW_SCHEMA = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export const INTENT_SCHEMA = z.object({
  bookingId: z.string().min(1),
});

const PAYOUT_SCHEMA = z.object({
  amountVnd: z.number().int().min(50000), // tối thiểu 50K
  method: z.enum(['BANK_TRANSFER', 'MOMO_WALLET']).default('BANK_TRANSFER'),
  accountDetails: z.object({
    bankName: z.string().optional(),
    accountNumber: z.string().optional(),
    accountHolder: z.string().optional(),
    phone: z.string().optional(),
  }),
});

const ICAL_FORWARD_DAYS = 60;

type CalendarItem = {
  id: string;
  kind: 'booking' | 'class' | 'blocked';
  title: string;
  startAt: string;
  endAt: string;
  status: string;
  tutorId: string | null;
  studentId: string | null;
  isTrial: boolean;
  subjectSlug: string | null;
};

/** Row tutoring_booking đầy đủ → shape camelCase y drizzle .returning() cũ. */
function mapBookingRow(row: tutoring_booking) {
  return {
    id: row.id,
    tutorId: row.tutor_id,
    studentId: row.student_id,
    studyGroupId: row.study_group_id,
    subjectSlug: row.subject_slug,
    level: row.level,
    startAt: row.start_at,
    endAt: row.end_at,
    rateVnd: row.rate_vnd,
    status: row.status,
    studentMessage: row.student_message,
    sessionNotes: row.session_notes,
    recordingId: row.recording_id,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
    isTrial: row.is_trial,
    originalStartAt: row.original_start_at,
    rescheduleCount: row.reschedule_count,
    packPurchaseId: row.pack_purchase_id,
  };
}

function mapReviewRow(row: tutor_review) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    reviewerId: row.reviewer_id,
    tutorId: row.tutor_id,
    rating: row.rating,
    comment: row.comment,
    hiddenAt: row.hidden_at,
    hiddenReason: row.hidden_reason,
    hiddenBy: row.hidden_by,
    tags: row.tags,
    helpfulCount: row.helpful_count,
    attachments: row.attachments,
    createdAt: row.created_at,
  };
}

function mapPayoutRow(row: tutor_payout) {
  return {
    id: row.id,
    tutorId: row.tutor_id,
    amountVnd: row.amount_vnd,
    status: row.status,
    method: row.method,
    accountDetails: row.account_details,
    processedBy: row.processed_by,
    note: row.note,
    requestedAt: row.requested_at,
    processedAt: row.processed_at,
  };
}

@Injectable()
export class TutoringBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly helpers: BookingHelpersService,
    private readonly provider: PaymentProviderService,
    private readonly notifications: NotificationsService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // GET /tutoring/bookings
  // ──────────────────────────────────────────────────────────

  async listBookings(userId: string, role: string, upcoming: boolean) {
    const myProfile = await this.prisma.tutor_profile.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });

    let roleCond: Prisma.tutoring_bookingWhereInput;
    if (role === 'student') {
      roleCond = { student_id: userId };
    } else if (role === 'tutor') {
      if (!myProfile) return { bookings: [] };
      roleCond = { tutor_id: myProfile.id };
    } else {
      // all — union student-side OR tutor-side
      roleCond = myProfile
        ? { OR: [{ student_id: userId }, { tutor_id: myProfile.id }] }
        : { student_id: userId };
    }

    const rows = await this.prisma.tutoring_booking.findMany({
      where: {
        AND: [roleCond, ...(upcoming ? [{ start_at: { gte: new Date() } }] : [])],
      },
      orderBy: { start_at: upcoming ? 'asc' : 'desc' },
      take: 50,
      select: {
        id: true,
        tutor_id: true,
        student_id: true,
        study_group_id: true,
        subject_slug: true,
        level: true,
        start_at: true,
        end_at: true,
        rate_vnd: true,
        status: true,
        student_message: true,
        session_notes: true,
        is_trial: true,
        created_at: true,
        tutor_profile: {
          select: {
            headline: true,
            avatar_url: true,
            user_id: true,
            user: { select: { name: true } },
          },
        },
        user: { select: { name: true, image: true } },
      },
    });

    return {
      bookings: rows.map((r) => ({
        id: r.id,
        tutorId: r.tutor_id,
        studentId: r.student_id,
        studyGroupId: r.study_group_id,
        subjectSlug: r.subject_slug,
        level: r.level,
        startAt: r.start_at,
        endAt: r.end_at,
        rateVnd: r.rate_vnd,
        status: r.status,
        studentMessage: r.student_message,
        sessionNotes: r.session_notes,
        isTrial: r.is_trial,
        createdAt: r.created_at,
        tutorHeadline: r.tutor_profile.headline,
        tutorAvatarUrl: r.tutor_profile.avatar_url,
        tutorUserId: r.tutor_profile.user_id,
        tutorName: r.tutor_profile.user.name,
        studentName: r.user.name,
        studentImage: r.user.image,
      })),
    };
  }

  // ──────────────────────────────────────────────────────────
  // POST /tutoring/bookings — rate-limit chạy ở controller TRƯỚC parse
  // (429 ưu tiên 400 như route cũ) nên body parse tay ở đây.
  // ──────────────────────────────────────────────────────────

  async createBooking(userId: string, raw: unknown) {
    const parsed = CREATE_SCHEMA.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException({ error: parsed.error.flatten() }, 400);
    }

    const startAt = new Date(parsed.data.startAt);
    const endAt = new Date(parsed.data.endAt);
    if (endAt <= startAt) {
      throw new HttpException({ error: 'endAt phải sau startAt' }, 400);
    }
    const durationMin = (endAt.getTime() - startAt.getTime()) / 60000;
    if (durationMin < 30 || durationMin > 240) {
      throw new HttpException({ error: 'Buổi học từ 30 phút đến 4 giờ' }, 400);
    }
    if (startAt.getTime() < Date.now() + 60 * 60 * 1000) {
      throw new HttpException({ error: 'Phải book trước ít nhất 1 giờ' }, 400);
    }

    // Tutor tồn tại + PUBLISHED + không phải mình
    const tutor = await this.prisma.tutor_profile.findUnique({
      where: { id: parsed.data.tutorId },
      select: {
        id: true,
        user_id: true,
        status: true,
        hourly_rate_vnd: true,
        instant_book_enabled: true,
        trial_session_enabled: true,
      },
    });
    if (!tutor || tutor.status !== 'PUBLISHED') {
      throw new HttpException({ error: 'Tutor không tồn tại / chưa publish' }, 404);
    }
    if (tutor.user_id === userId) {
      throw new HttpException({ error: 'Không thể book chính mình' }, 400);
    }

    // V4 T2: validate trial eligibility
    const isTrial = parsed.data.isTrial === true;
    if (isTrial) {
      if (!tutor.trial_session_enabled) {
        throw new HttpException({ error: 'Gia sư này không bật trial session' }, 400);
      }
      // Check 1 trial / pair (student, tutor) — partial unique sẽ block insert,
      // nhưng pre-check để trả error friendly
      const prior = await this.prisma.tutoring_booking.findFirst({
        where: { student_id: userId, tutor_id: tutor.id, is_trial: true },
        select: { id: true },
      });
      if (prior) {
        throw new HttpException(
          { error: 'Bạn đã dùng trial với gia sư này — đặt buổi học chính thức.' },
          400,
        );
      }
      // Trial bắt buộc 30 phút
      if (durationMin !== 30) {
        throw new HttpException({ error: 'Trial chỉ dài 30 phút' }, 400);
      }
    }

    // Slot fit availability
    const fits = await this.helpers.isSlotInAvailability(tutor.id, startAt, endAt);
    if (!fits) {
      throw new HttpException(
        { error: 'Khung giờ không nằm trong lịch rảnh của gia sư' },
        400,
      );
    }

    // No conflict
    const conflict = await this.helpers.hasConflictBooking(tutor.id, startAt, endAt);
    if (conflict) {
      throw new HttpException(
        { error: 'Khung giờ này đã có booking khác — chọn giờ khác' },
        409,
      );
    }

    // Tính rateVnd: per-hour rate × duration hours, trial giảm 50%
    const baseRate = Math.round(tutor.hourly_rate_vnd * (durationMin / 60));
    const rateVnd = isTrial ? Math.round(baseRate / 2) : baseRate;

    // V4 T2: Instant Book — tutor opt-in cho phép student book ngay.
    // NOTE giữ từ bản cũ: instant-book CONFIRMED nhưng KHÔNG auto-create study
    // group ở đây — studyGroupId=null tới khi /confirm được gọi (gap V4.1).
    const status = tutor.instant_book_enabled ? 'CONFIRMED' : 'PENDING_TUTOR';
    const confirmedAt = tutor.instant_book_enabled ? new Date() : null;

    const created = await this.prisma.tutoring_booking.create({
      data: {
        id: randomUUID(),
        tutor_id: tutor.id,
        student_id: userId,
        subject_slug: parsed.data.subjectSlug,
        level: parsed.data.level,
        start_at: startAt,
        end_at: endAt,
        rate_vnd: rateVnd,
        status,
        confirmed_at: confirmedAt,
        student_message: parsed.data.studentMessage ?? null,
        is_trial: isTrial,
      },
    });

    // Booking mới hiện ở "Đơn học sắp tới" của CẢ student + tutor → xoá cache mine cả hai.
    await onTutoringMineChanged(userId);
    await onTutoringMineChanged(tutor.user_id);

    return { booking: mapBookingRow(created), instantBooked: tutor.instant_book_enabled };
  }

  // ──────────────────────────────────────────────────────────
  // GET /tutoring/bookings/:id
  // ──────────────────────────────────────────────────────────

  async getBooking(userId: string, id: string) {
    const row = await this.prisma.tutoring_booking.findUnique({
      where: { id },
      select: {
        id: true,
        tutor_id: true,
        student_id: true,
        study_group_id: true,
        subject_slug: true,
        level: true,
        start_at: true,
        end_at: true,
        rate_vnd: true,
        status: true,
        student_message: true,
        session_notes: true,
        created_at: true,
        confirmed_at: true,
        completed_at: true,
        cancelled_at: true,
        cancel_reason: true,
        tutor_profile: {
          select: {
            user_id: true,
            headline: true,
            avatar_url: true,
            user: { select: { name: true } },
          },
        },
        user: { select: { name: true, image: true } },
        study_group: { select: { name: true } },
      },
    });

    if (!row) throw new HttpException({ error: 'Not found' }, 404);

    const isStudent = row.student_id === userId;
    const isTutor = row.tutor_profile.user_id === userId;
    if (!isStudent && !isTutor) {
      throw new HttpException({ error: 'Forbidden' }, 403);
    }

    const review = await this.prisma.tutor_review.findUnique({
      where: { booking_id: id },
    });

    const payment = await this.prisma.tutoring_payment.findUnique({
      where: { booking_id: id },
      select: { id: true, order_code: true, amount_vnd: true, provider: true, status: true },
    });

    return {
      booking: {
        id: row.id,
        tutorId: row.tutor_id,
        studentId: row.student_id,
        studyGroupId: row.study_group_id,
        subjectSlug: row.subject_slug,
        level: row.level,
        startAt: row.start_at,
        endAt: row.end_at,
        rateVnd: row.rate_vnd,
        status: row.status,
        studentMessage: row.student_message,
        sessionNotes: row.session_notes,
        createdAt: row.created_at,
        confirmedAt: row.confirmed_at,
        completedAt: row.completed_at,
        cancelledAt: row.cancelled_at,
        cancelReason: row.cancel_reason,
        tutorUserId: row.tutor_profile.user_id,
        tutorHeadline: row.tutor_profile.headline,
        tutorAvatarUrl: row.tutor_profile.avatar_url,
        tutorName: row.tutor_profile.user.name,
        studentName: row.user.name,
        studentImage: row.user.image,
        studyGroupName: row.study_group?.name ?? null,
      },
      review: review ? mapReviewRow(review) : null,
      payment: payment
        ? {
            id: payment.id,
            orderCode: payment.order_code,
            amountVnd: payment.amount_vnd,
            provider: payment.provider,
            status: payment.status,
          }
        : null,
      role: isTutor ? 'tutor' : 'student',
    };
  }

  // ──────────────────────────────────────────────────────────
  // POST /tutoring/bookings/:id/confirm
  // ──────────────────────────────────────────────────────────

  async confirmBooking(userId: string, id: string) {
    // Booking + tutor + student user info — fetch sẵn ngoài transaction
    const row = await this.prisma.tutoring_booking.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        tutor_id: true,
        student_id: true,
        subject_slug: true,
        rate_vnd: true,
        tutor_profile: { select: { user_id: true } },
      },
    });

    if (!row) throw new HttpException({ error: 'Not found' }, 404);
    const tutorUserId = row.tutor_profile.user_id;
    if (tutorUserId !== userId) {
      throw new HttpException({ error: 'Chỉ gia sư mới confirm được' }, 403);
    }
    if (row.status !== 'PENDING_TUTOR') {
      throw new HttpException(
        { error: `Booking đang ở status ${row.status}, không confirm được` },
        400,
      );
    }

    const subjectName = SUBJECT_BY_SLUG[row.subject_slug]?.name ?? row.subject_slug;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create study group + channels
      const group = await this.helpers.autoCreateBookingGroup(tx, {
        bookingId: row.id,
        tutorUserId,
        studentUserId: row.student_id,
        subjectName,
      });

      // 2. Update booking
      const updated = await tx.tutoring_booking.update({
        where: { id: row.id },
        data: {
          status: 'CONFIRMED',
          confirmed_at: new Date(),
          study_group_id: group.groupId,
        },
      });

      // 3. Create payment STUB — V3 wire VNPay thật ở bước intent riêng.
      // Stub auto-CAPTURED ngay để dev test full flow không cần payment gateway.
      const fee = Math.round(row.rate_vnd * 0.1); // 10% Cogniva commission
      const orderCode = `BK-${row.id.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
      await tx.tutoring_payment.create({
        data: {
          id: randomUUID(),
          booking_id: row.id,
          amount_vnd: row.rate_vnd,
          fee_vnd: fee,
          provider: 'STUB',
          provider_ref: `stub-${Date.now()}`,
          order_code: orderCode,
          status: 'CAPTURED',
          captured_at: new Date(),
          // Escrow release 7 ngày sau completedAt — tính lúc complete
          escrow_release_at: null,
          raw_response: { mode: 'dev-stub', note: 'auto-captured on confirm' },
        },
      });

      return { booking: mapBookingRow(updated), group };
    });

    // Status PENDING→CONFIRMED đổi "Đơn học sắp tới" của CẢ student + tutor → xoá cache mine cả hai.
    await onTutoringMineChanged(row.student_id);
    await onTutoringMineChanged(tutorUserId);

    // Thông báo cho học viên: gia sư đã xác nhận (realtime, non-blocking).
    void this.notifications
      .createNotification({
        userId: row.student_id,
        type: 'booking-confirmed',
        title: 'Gia sư đã xác nhận buổi học',
        body: `Buổi ${subjectName} đã được xác nhận — xem chi tiết & thanh toán.`,
        data: { bookingId: row.id, role: 'student' },
      })
      .catch((e) => console.error('[booking.confirm notify]', e));

    return result;
  }

  // ──────────────────────────────────────────────────────────
  // POST /tutoring/bookings/:id/cancel
  // ──────────────────────────────────────────────────────────

  async cancelBooking(user: AuthUser, id: string, body: z.infer<typeof CANCEL_SCHEMA>) {
    const userId = user.id;

    const row = await this.prisma.tutoring_booking.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        student_id: true,
        start_at: true,
        rate_vnd: true,
        tutor_profile: { select: { user_id: true } },
      },
    });

    if (!row) throw new HttpException({ error: 'Not found' }, 404);
    const tutorUserId = row.tutor_profile.user_id;

    const isStudent = row.student_id === userId;
    const isTutor = tutorUserId === userId;
    if (!isStudent && !isTutor) {
      throw new HttpException({ error: 'Forbidden' }, 403);
    }
    if (row.status === 'COMPLETED' || row.status === 'CANCELLED') {
      throw new HttpException({ error: `Booking đã ${row.status}` }, 400);
    }
    if (row.status === 'IN_PROGRESS') {
      throw new HttpException({ error: 'Buổi đã bắt đầu — không huỷ được' }, 400);
    }

    // Apply policy chỉ với CONFIRMED — PENDING_TUTOR luôn free.
    let policyNote: string | null = null;
    if (row.status === 'CONFIRMED') {
      const policy = evaluateCancelPolicy(row.start_at, row.rate_vnd);
      if (!policy.allowed) {
        throw new HttpException({ error: policy.reason }, 400);
      }
      policyNote = policy.reason;
    }

    // Lookup payment để gọi refund nếu đã CAPTURED (chỉ provider thật cần)
    const pay = await this.prisma.tutoring_payment.findUnique({
      where: { booking_id: row.id },
      select: {
        id: true,
        provider: true,
        status: true,
        order_code: true,
        provider_ref: true,
        amount_vnd: true,
      },
    });

    // Gọi provider refund (ngoài transaction để fetch HTTP không block lock).
    // STUB: ok ngay; VNPAY/MOMO: call API, nếu fail → trả về error nhưng vẫn
    // cancel booking (admin sẽ refund manual + flag DB sau).
    let refundNote: string | null = null;
    let refundOk = true;
    if (pay && pay.status === 'CAPTURED') {
      const refund = await this.provider.refundPayment({
        provider: pay.provider as PaymentProviderName,
        orderCode: pay.order_code,
        providerRef: pay.provider_ref,
        amountVnd: pay.amount_vnd,
        reason: body.reason ?? 'Booking cancelled',
        initiatedBy: user.email ?? userId,
      });
      refundOk = refund.ok;
      refundNote = refund.message;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tutoring_booking.update({
        where: { id: row.id },
        data: {
          status: 'CANCELLED',
          cancelled_at: new Date(),
          cancelled_by: userId,
          cancel_reason: body.reason ?? null,
        },
      });

      if (pay && pay.status === 'CAPTURED' && refundOk) {
        // Provider OK → flag DB REFUNDED. Nếu refund fail trên VNPay/MoMo →
        // giữ status cũ, admin sẽ xử lý manual (refundNote trả về client).
        await tx.tutoring_payment.updateMany({
          where: { id: pay.id },
          data: { status: 'REFUNDED', refunded_at: new Date() },
        });
      }
    });

    // Booking CANCELLED đổi "Đơn học sắp tới" của CẢ student + tutor → xoá cache mine cả hai.
    await onTutoringMineChanged(row.student_id);
    await onTutoringMineChanged(tutorUserId);

    // Thông báo cho bên CÒN LẠI (người không bấm huỷ) — realtime.
    const recipientUserId = isStudent ? tutorUserId : row.student_id;
    void this.notifications
      .createNotification({
        userId: recipientUserId,
        type: 'booking-cancelled',
        title: 'Buổi học đã bị huỷ',
        body: body.reason
          ? `Lý do: ${body.reason}`
          : `${isStudent ? 'Học viên' : 'Gia sư'} đã huỷ buổi học.`,
        data: { bookingId: row.id, role: isStudent ? 'tutor' : 'student' },
      })
      .catch((e) => console.error('[booking.cancel notify]', e));

    return {
      ok: true,
      policyNote,
      refund: pay ? { ok: refundOk, message: refundNote } : null,
    };
  }

  // ──────────────────────────────────────────────────────────
  // POST /tutoring/bookings/:id/complete
  // ──────────────────────────────────────────────────────────

  async completeBooking(userId: string, id: string) {
    const row = await this.prisma.tutoring_booking.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        tutor_id: true,
        student_id: true,
        end_at: true,
        tutor_profile: { select: { user_id: true } },
      },
    });

    if (!row) throw new HttpException({ error: 'Not found' }, 404);
    const tutorUserId = row.tutor_profile.user_id;
    if (tutorUserId !== userId) {
      throw new HttpException({ error: 'Chỉ gia sư mới mark completed được' }, 403);
    }
    if (row.status !== 'CONFIRMED' && row.status !== 'IN_PROGRESS') {
      throw new HttpException({ error: `Status ${row.status} không complete được` }, 400);
    }
    if (row.end_at.getTime() > Date.now()) {
      throw new HttpException({ error: 'Buổi học chưa kết thúc' }, 400);
    }

    const now = new Date();
    const escrowReleaseAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.tutoring_booking.update({
        where: { id: row.id },
        data: { status: 'COMPLETED', completed_at: now },
      });
      // Bản cũ update theo bookingId không điều kiện tồn tại → updateMany no-op
      // nếu booking chưa có payment (không throw P2025).
      await tx.tutoring_payment.updateMany({
        where: { booking_id: row.id },
        data: { escrow_release_at: escrowReleaseAt },
      });
    });

    await this.helpers.refreshTutorStats(row.tutor_id);

    // COMPLETED gỡ khỏi "Đơn học sắp tới" + tutor profile (sessionsCompleted++) đổi →
    // xoá cache mine của CẢ student + tutor.
    await onTutoringMineChanged(row.student_id);
    await onTutoringMineChanged(tutorUserId);

    // Thông báo cho học viên: buổi học xong → mời đánh giá (realtime).
    void this.notifications
      .createNotification({
        userId: row.student_id,
        type: 'booking-completed',
        title: 'Buổi học đã hoàn thành',
        body: 'Hãy đánh giá gia sư để giúp cộng đồng nhé.',
        data: { bookingId: row.id, role: 'student' },
      })
      .catch((e) => console.error('[booking.complete notify]', e));

    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────
  // POST /tutoring/bookings/:id/review
  // ──────────────────────────────────────────────────────────

  async reviewBooking(userId: string, id: string, body: z.infer<typeof REVIEW_SCHEMA>) {
    const row = await this.prisma.tutoring_booking.findUnique({
      where: { id },
      select: { id: true, status: true, tutor_id: true, student_id: true },
    });

    if (!row) throw new HttpException({ error: 'Not found' }, 404);
    if (row.student_id !== userId) {
      throw new HttpException({ error: 'Chỉ học sinh tham gia mới review được' }, 403);
    }
    if (row.status !== 'COMPLETED') {
      throw new HttpException({ error: 'Chỉ review được buổi đã COMPLETED' }, 400);
    }

    // Check trùng — unique(bookingId)
    const existing = await this.prisma.tutor_review.findUnique({
      where: { booking_id: id },
      select: { id: true },
    });
    if (existing) {
      throw new HttpException({ error: 'Bạn đã review buổi này' }, 409);
    }

    let created: tutor_review;
    try {
      created = await this.prisma.tutor_review.create({
        data: {
          id: randomUUID(),
          booking_id: id,
          reviewer_id: userId,
          tutor_id: row.tutor_id,
          rating: body.rating,
          comment: body.comment ?? null,
        },
      });
    } catch (err) {
      // Race check-then-insert: unique(booking_id) backstop → 409 như pre-check.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new HttpException({ error: 'Bạn đã review buổi này' }, 409);
      }
      throw err;
    }

    await this.helpers.refreshTutorStats(row.tutor_id);

    return { review: mapReviewRow(created) };
  }

  // ──────────────────────────────────────────────────────────
  // GET /tutoring/calendar/me
  // ──────────────────────────────────────────────────────────

  async calendarMe(userId: string, from?: string, to?: string) {
    const fromDate = from ? new Date(from) : new Date();
    const toDate = to
      ? new Date(to)
      : new Date(fromDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    // 1. Get my tutor profile (if any) — quyết định query range
    const myProfile = await this.prisma.tutor_profile.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });

    const items: CalendarItem[] = [];

    // 2. Bookings — user là student hoặc tutor (fail-open per-source như bản cũ)
    try {
      const bookingWhere: Prisma.tutoring_bookingWhereInput = myProfile
        ? { OR: [{ student_id: userId }, { tutor_id: myProfile.id }] }
        : { student_id: userId };

      const bookings = await this.prisma.tutoring_booking.findMany({
        where: {
          AND: [
            bookingWhere,
            { status: { not: 'CANCELLED' } },
            { start_at: { gte: fromDate, lte: toDate } },
          ],
        },
        orderBy: { start_at: 'asc' },
        take: 200,
        select: {
          id: true,
          subject_slug: true,
          start_at: true,
          end_at: true,
          status: true,
          tutor_id: true,
          student_id: true,
          is_trial: true,
        },
      });

      for (const b of bookings) {
        items.push({
          id: b.id,
          kind: 'booking',
          title: `Buổi học · ${b.subject_slug}`,
          startAt: b.start_at.toISOString(),
          endAt: b.end_at.toISOString(),
          status: b.status,
          tutorId: b.tutor_id,
          studentId: b.student_id,
          isTrial: b.is_trial,
          subjectSlug: b.subject_slug,
        });
      }
    } catch (err) {
      console.error('[calendar.bookings]', err);
    }

    // 3. Class enrollments — user là student trong class
    try {
      const enrollments = await this.prisma.tutoring_class_enrollment.findMany({
        where: { student_id: userId, status: 'ENROLLED' },
        select: { class_id: true },
        take: 50,
      });

      if (enrollments.length > 0) {
        const classIds = enrollments.map((e) => e.class_id);
        const classes = await this.prisma.tutoring_class.findMany({
          where: { id: { in: classIds } },
          select: {
            id: true,
            title: true,
            subject_slug: true,
            tutor_id: true,
            start_date: true,
            duration_min: true,
            status: true,
          },
        });

        for (const c of classes) {
          // Class start time = startDate + 08:00 default (V4.1: parse schedule_slots).
          // Prisma @db.Date trả Date UTC-midnight — format lại YYYY-MM-DD như cột text Drizzle cũ.
          const dateStr = c.start_date.toISOString().slice(0, 10);
          const startAt = new Date(`${dateStr}T08:00:00.000Z`);
          if (Number.isNaN(startAt.getTime())) continue;
          if (startAt < fromDate || startAt > toDate) continue;
          const endAt = new Date(startAt.getTime() + c.duration_min * 60_000);
          items.push({
            id: c.id,
            kind: 'class',
            title: c.title,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            status: c.status,
            tutorId: c.tutor_id,
            studentId: userId,
            isTrial: false,
            subjectSlug: c.subject_slug,
          });
        }
      }
    } catch (err) {
      console.error('[calendar.classes]', err);
    }

    // 4. Blocked time — chỉ tutor owner mới thấy
    if (myProfile) {
      try {
        const blocked = await this.prisma.tutor_blocked_time.findMany({
          where: { tutor_id: myProfile.id, start_at: { gte: fromDate, lte: toDate } },
          select: { id: true, start_at: true, end_at: true, reason: true, tutor_id: true },
          take: 50,
        });

        for (const b of blocked) {
          items.push({
            id: b.id,
            kind: 'blocked',
            title: b.reason ? `Bận · ${b.reason}` : 'Đã block',
            startAt: b.start_at.toISOString(),
            endAt: b.end_at.toISOString(),
            status: 'BLOCKED',
            tutorId: b.tutor_id,
            studentId: null,
            isTrial: false,
            subjectSlug: null,
          });
        }
      } catch (err) {
        console.error('[calendar.blocked]', err);
      }
    }

    return {
      items,
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
    };
  }

  // ──────────────────────────────────────────────────────────
  // GET /tutoring/ical/:token — public, trả text/calendar (không JSON)
  // ──────────────────────────────────────────────────────────

  async buildIcalFeedForToken(
    token: string,
  ): Promise<{ error: string; status: number } | { ics: string }> {
    if (!token || token.length < 8) {
      return { error: 'Invalid token', status: 400 };
    }

    // Tìm token thuộc tutor hay student
    const tutor = await this.prisma.tutor_profile.findFirst({
      where: { ical_token: token },
      select: { id: true, user_id: true },
    });

    const studentUser = await this.prisma.user.findFirst({
      where: { booking_ical_token: token },
      select: { id: true, name: true },
    });

    if (!tutor && !studentUser) {
      return { error: 'Token không hợp lệ', status: 404 };
    }

    const from = new Date();
    const to = new Date(Date.now() + ICAL_FORWARD_DAYS * 24 * 60 * 60 * 1000);

    const bookings = await this.prisma.tutoring_booking.findMany({
      where: tutor ? { tutor_id: tutor.id } : { student_id: studentUser!.id },
      orderBy: { start_at: 'asc' },
      select: {
        id: true,
        subject_slug: true,
        start_at: true,
        end_at: true,
        status: true,
        tutor_profile: { select: { user: { select: { name: true } } } },
      },
    });

    // Filter trong window + status CONFIRMED / IN_PROGRESS / PENDING_TUTOR (in-JS như bản cũ)
    const events: IcalEvent[] = bookings
      .filter(
        (b) =>
          b.start_at >= from &&
          b.start_at <= to &&
          ['CONFIRMED', 'IN_PROGRESS', 'PENDING_TUTOR'].includes(b.status),
      )
      .map((b) => ({
        uid: b.id,
        summary: `Buổi học · ${b.subject_slug}${
          studentUser ? ` với ${b.tutor_profile.user.name ?? 'gia sư'}` : ''
        }`,
        description: `Booking #${b.id} (${b.status})`,
        startAt: b.start_at,
        endAt: b.end_at,
        // api .env không có NEXT_PUBLIC_* — APP_URL là origin web (setup-env ghi).
        url: `${process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''}/tutoring/bookings/${b.id}`,
      }));

    const title = tutor
      ? 'Cogniva — Lịch dạy'
      : `Cogniva — Lịch học của ${studentUser?.name ?? 'bạn'}`;

    return { ics: buildIcsFeed({ title, events }) };
  }

  // ──────────────────────────────────────────────────────────
  // POST /tutoring/payments/intent
  // ──────────────────────────────────────────────────────────

  async createIntent(userId: string, body: z.infer<typeof INTENT_SCHEMA>) {
    const booking = await this.prisma.tutoring_booking.findUnique({
      where: { id: body.bookingId },
      select: {
        id: true,
        status: true,
        student_id: true,
        rate_vnd: true,
        subject_slug: true,
      },
    });

    if (!booking) throw new HttpException({ error: 'Not found' }, 404);
    if (booking.student_id !== userId) {
      throw new HttpException({ error: 'Forbidden' }, 403);
    }
    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
      throw new HttpException({ error: `Booking ${booking.status} — không tạo intent` }, 400);
    }

    // Idempotent — nếu payment CAPTURED rồi return URL stub luôn
    const existing = await this.prisma.tutoring_payment.findUnique({
      where: { booking_id: booking.id },
      select: { id: true, status: true, order_code: true, provider: true },
    });

    if (existing && existing.status === 'CAPTURED') {
      return {
        paymentId: existing.id,
        paymentUrl: null,
        orderCode: existing.order_code,
        provider: existing.provider,
        reused: true,
        already: 'CAPTURED',
      };
    }

    // Build orderCode unique
    const orderCode =
      existing?.order_code ?? `BK-${booking.id.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;

    // Insert/upsert payment row
    let paymentId: string;
    if (existing) {
      paymentId = existing.id;
      await this.prisma.tutoring_payment.update({
        where: { id: paymentId },
        data: { status: 'CREATED' },
      });
    } else {
      paymentId = randomUUID();
      await this.prisma.tutoring_payment.create({
        data: {
          id: paymentId,
          booking_id: booking.id,
          amount_vnd: booking.rate_vnd,
          fee_vnd: Math.round(booking.rate_vnd * 0.1),
          provider: 'STUB',
          order_code: orderCode,
          status: 'CREATED',
        },
      });
    }

    // Call provider — bản cũ lấy origin từ request.url (origin web cùng máy);
    // sau proxy strangler Host header là API nội bộ nên dùng APP_URL (origin
    // user-facing) thay vì reconstruct từ request.
    const origin = process.env.APP_URL ?? 'http://localhost:3000';
    const returnUrl = `${origin}/tutoring/bookings/${booking.id}`;
    const intent = await this.provider.createPaymentIntent({
      orderCode,
      amountVnd: booking.rate_vnd,
      description: `Cogniva tutoring booking ${booking.id.slice(0, 8)}`,
      returnUrl,
    });

    // Update payment row with resolved provider + raw request
    await this.prisma.tutoring_payment.update({
      where: { id: paymentId },
      data: {
        provider: intent.resolvedProvider,
        raw_response: { request: intent.rawRequest } as Prisma.InputJsonValue,
      },
    });

    return {
      paymentId,
      paymentUrl: intent.paymentUrl,
      orderCode,
      provider: intent.resolvedProvider,
    };
  }

  // ──────────────────────────────────────────────────────────
  // POST /tutoring/payments/:id/capture — CHỈ provider STUB
  // ──────────────────────────────────────────────────────────

  async capturePayment(userId: string, id: string) {
    const pay = await this.prisma.tutoring_payment.findUnique({
      where: { id },
      select: {
        id: true,
        booking_id: true,
        provider: true,
        status: true,
        order_code: true,
        tutoring_booking: { select: { student_id: true } },
      },
    });

    if (!pay) throw new HttpException({ error: 'Not found' }, 404);
    if (pay.tutoring_booking.student_id !== userId) {
      throw new HttpException({ error: 'Forbidden' }, 403);
    }
    if (pay.provider !== 'STUB') {
      throw new HttpException(
        { error: `Capture endpoint chỉ cho STUB. Provider ${pay.provider} dùng webhook.` },
        400,
      );
    }
    if (pay.status === 'CAPTURED') {
      return { ok: true, already: 'CAPTURED' };
    }
    if (pay.status === 'REFUNDED' || pay.status === 'FAILED') {
      throw new HttpException({ error: `Payment ${pay.status}, không capture được` }, 400);
    }

    await this.prisma.tutoring_payment.update({
      where: { id: pay.id },
      data: {
        status: 'CAPTURED',
        captured_at: new Date(),
        provider_ref: `stub-${Date.now()}`,
      },
    });

    return { ok: true, captured: true };
  }

  // ──────────────────────────────────────────────────────────
  // GET + POST /tutoring/payouts
  // ──────────────────────────────────────────────────────────

  private async getMyTutor(userId: string) {
    const row = await this.prisma.tutor_profile.findUnique({
      where: { user_id: userId },
      select: { id: true, verification_status: true },
    });
    return row ? { id: row.id, verificationStatus: row.verification_status } : null;
  }

  /**
   * Earnings summary — aggregate raw SQL như bản cũ: released so sánh
   * escrow_release_at <= NOW() phía DB (DB time, không phải app time).
   */
  private async computeEarnings(tutorId: string) {
    const earnedRow = await this.prisma.$queryRaw<Array<{ total: number; released: number }>>(
      Prisma.sql`
        SELECT
          COALESCE(SUM(tutoring_payment.amount_vnd - tutoring_payment.fee_vnd), 0)::int AS total,
          COALESCE(SUM(
            CASE WHEN tutoring_payment.escrow_release_at IS NOT NULL
                      AND tutoring_payment.escrow_release_at <= NOW()
                 THEN tutoring_payment.amount_vnd - tutoring_payment.fee_vnd
                 ELSE 0 END
          ), 0)::int AS released
        FROM tutoring_payment
        INNER JOIN tutoring_booking ON tutoring_booking.id = tutoring_payment.booking_id
        WHERE tutoring_booking.tutor_id = ${tutorId}
          AND tutoring_payment.status = 'CAPTURED'
      `,
    );

    const paidOutRow = await this.prisma.$queryRaw<Array<{ paidOut: number; pending: number }>>(
      Prisma.sql`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount_vnd ELSE 0 END), 0)::int AS "paidOut",
          COALESCE(SUM(CASE WHEN status IN ('REQUESTED','APPROVED') THEN amount_vnd ELSE 0 END), 0)::int AS pending
        FROM tutor_payout
        WHERE tutor_id = ${tutorId}
      `,
    );

    const earned = Number(earnedRow[0]?.total ?? 0);
    const released = Number(earnedRow[0]?.released ?? 0);
    const paidOut = Number(paidOutRow[0]?.paidOut ?? 0);
    const pending = Number(paidOutRow[0]?.pending ?? 0);
    const withdrawable = Math.max(0, released - paidOut - pending);

    return { earned, released, paidOut, pending, withdrawable };
  }

  async listPayouts(userId: string) {
    const mine = await this.getMyTutor(userId);
    if (!mine) {
      return {
        tutor: null,
        payouts: [],
        summary: { earned: 0, released: 0, paidOut: 0, pending: 0, withdrawable: 0 },
      };
    }

    const [payouts, summary] = await Promise.all([
      this.prisma.tutor_payout.findMany({
        where: { tutor_id: mine.id },
        orderBy: { requested_at: 'desc' },
        take: 20,
      }),
      this.computeEarnings(mine.id),
    ]);

    return { tutor: mine, payouts: payouts.map(mapPayoutRow), summary };
  }

  /** POST payouts — 403 tutor/KYC check TRƯỚC body parse (giữ thứ tự bản cũ). */
  async requestPayout(userId: string, raw: unknown) {
    const mine = await this.getMyTutor(userId);
    if (!mine) {
      throw new HttpException({ error: 'Bạn không phải tutor' }, 403);
    }
    if (mine.verificationStatus !== 'KYC_VERIFIED') {
      throw new HttpException({ error: 'Cần KYC verified trước khi rút tiền' }, 403);
    }

    const parsed = PAYOUT_SCHEMA.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException({ error: parsed.error.flatten() }, 400);
    }

    const summary = await this.computeEarnings(mine.id);
    if (parsed.data.amountVnd > summary.withdrawable) {
      throw new HttpException(
        { error: `Số tiền vượt quá khả năng rút (${summary.withdrawable} VND)`, summary },
        400,
      );
    }

    const created = await this.prisma.tutor_payout.create({
      data: {
        id: randomUUID(),
        tutor_id: mine.id,
        amount_vnd: parsed.data.amountVnd,
        method: parsed.data.method,
        account_details: parsed.data.accountDetails as Prisma.InputJsonValue,
        status: 'REQUESTED',
      },
    });

    return { payout: mapPayoutRow(created) };
  }
}
