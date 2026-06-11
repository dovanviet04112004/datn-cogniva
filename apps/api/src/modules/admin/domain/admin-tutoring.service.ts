/**
 * AdminTutoringService — port từ apps/web/src/app/api/admin/tutoring/**.
 *
 * Refund là STUB y route cũ: chỉ flip payment.status=REFUNDED + refunded_at,
 * KHÔNG gọi VNPay/MoMo API (admin xử lý ngoài); partial amount chỉ nằm trong
 * audit payload + notification, KHÔNG persist lên payment row.
 * Hide/restore review KHÔNG recompute rating trung bình tutor (y cũ).
 */
import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import type { AdminContext } from '../../../common/admin/admin.guard';
import { clampLimit, parseCursor, type RefundInput } from './dto/admin-domain.dto';

@Injectable()
export class AdminTutoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  /* ── Bookings ──────────────────────────────────────────────────────────── */

  /** GET /admin/tutoring/bookings — cursor theo startAt (KHÔNG phải createdAt). */
  async listBookings(params: { q?: string; status?: string; cursor?: string; limit?: string }) {
    const q = params.q?.trim() ?? '';
    const limit = clampLimit(params.limit, 50, 100);

    const where: Prisma.tutoring_bookingWhereInput = {};
    let conditions = 0;
    if (q) {
      where.OR = [
        { tutor_profile: { user: { email: { contains: q, mode: 'insensitive' } } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ];
      conditions++;
    }
    if (params.status) {
      where.status = params.status;
      conditions++;
    }
    const cursorDate = parseCursor(params.cursor);
    if (cursorDate) {
      where.start_at = { lt: cursorDate };
      conditions++;
    }

    const rows = await this.prisma.tutoring_booking.findMany({
      where,
      select: {
        id: true,
        status: true,
        subject_slug: true,
        level: true,
        start_at: true,
        end_at: true,
        rate_vnd: true,
        created_at: true,
        cancelled_at: true,
        cancelled_by: true,
        tutor_id: true,
        student_id: true,
        tutor_profile: {
          select: { user_id: true, user: { select: { name: true, email: true } } },
        },
        user: { select: { name: true, email: true } },
        tutoring_payment: { select: { status: true, provider: true, amount_vnd: true } },
      },
      orderBy: { start_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && trimmed.length > 0
        ? trimmed[trimmed.length - 1]!.start_at.toISOString()
        : null;

    let total: number | null = null;
    if (conditions === 0) {
      total = await this.prisma.tutoring_booking.count();
    }

    return {
      bookings: trimmed.map((b) => ({
        id: b.id,
        status: b.status,
        subjectSlug: b.subject_slug,
        level: b.level,
        startAt: b.start_at.toISOString(),
        endAt: b.end_at.toISOString(),
        rateVnd: b.rate_vnd,
        createdAt: b.created_at.toISOString(),
        cancelledAt: b.cancelled_at?.toISOString() ?? null,
        cancelledBy: b.cancelled_by,
        tutorProfileId: b.tutor_id,
        tutorUserId: b.tutor_profile.user_id,
        tutorName: b.tutor_profile.user.name,
        tutorEmail: b.tutor_profile.user.email,
        studentId: b.student_id,
        studentName: b.user.name,
        studentEmail: b.user.email,
        paymentStatus: b.tutoring_payment?.status ?? null,
        paymentProvider: b.tutoring_payment?.provider ?? null,
        paymentAmountVnd: b.tutoring_payment?.amount_vnd ?? null,
      })),
      nextCursor,
      total,
    };
  }

  /** GET /admin/tutoring/bookings/:id — full detail + payment full row + review. */
  async getBookingDetail(id: string) {
    const row = await this.prisma.tutoring_booking.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        subject_slug: true,
        level: true,
        start_at: true,
        end_at: true,
        rate_vnd: true,
        student_message: true,
        session_notes: true,
        recording_id: true,
        study_group_id: true,
        created_at: true,
        confirmed_at: true,
        completed_at: true,
        cancelled_at: true,
        cancelled_by: true,
        cancel_reason: true,
        tutor_id: true,
        student_id: true,
        tutor_profile: {
          select: {
            user_id: true,
            headline: true,
            user: { select: { name: true, email: true, image: true } },
          },
        },
        user: { select: { name: true, email: true, image: true } },
      },
    });
    if (!row) throw new NotFoundException({ error: 'Booking not found' });

    const [payment, review] = await Promise.all([
      this.prisma.tutoring_payment.findUnique({ where: { booking_id: id } }),
      this.prisma.tutor_review.findUnique({ where: { booking_id: id } }),
    ]);

    return {
      booking: {
        id: row.id,
        status: row.status,
        subjectSlug: row.subject_slug,
        level: row.level,
        startAt: row.start_at.toISOString(),
        endAt: row.end_at.toISOString(),
        rateVnd: row.rate_vnd,
        studentMessage: row.student_message,
        sessionNotes: row.session_notes,
        recordingId: row.recording_id,
        studyGroupId: row.study_group_id,
        createdAt: row.created_at.toISOString(),
        confirmedAt: row.confirmed_at?.toISOString() ?? null,
        completedAt: row.completed_at?.toISOString() ?? null,
        cancelledAt: row.cancelled_at?.toISOString() ?? null,
        cancelledBy: row.cancelled_by,
        cancelReason: row.cancel_reason,
        tutorProfileId: row.tutor_id,
        tutorUserId: row.tutor_profile.user_id,
        tutorHeadline: row.tutor_profile.headline,
        tutorName: row.tutor_profile.user.name,
        tutorEmail: row.tutor_profile.user.email,
        tutorImage: row.tutor_profile.user.image,
        studentId: row.student_id,
        studentName: row.user.name,
        studentEmail: row.user.email,
        studentImage: row.user.image,
      },
      // Payment full row (kèm raw provider response — chỉ admin xem), key
      // camelCase y select() drizzle cũ.
      payment: payment
        ? {
            id: payment.id,
            bookingId: payment.booking_id,
            amountVnd: payment.amount_vnd,
            feeVnd: payment.fee_vnd,
            provider: payment.provider,
            providerRef: payment.provider_ref,
            orderCode: payment.order_code,
            status: payment.status,
            escrowReleaseAt: payment.escrow_release_at?.toISOString() ?? null,
            rawResponse: payment.raw_response,
            createdAt: payment.created_at.toISOString(),
            capturedAt: payment.captured_at?.toISOString() ?? null,
            refundedAt: payment.refunded_at?.toISOString() ?? null,
          }
        : null,
      review: review
        ? {
            id: review.id,
            bookingId: review.booking_id,
            reviewerId: review.reviewer_id,
            tutorId: review.tutor_id,
            rating: review.rating,
            comment: review.comment,
            hiddenAt: review.hidden_at?.toISOString() ?? null,
            hiddenReason: review.hidden_reason,
            hiddenBy: review.hidden_by,
            tags: review.tags,
            helpfulCount: review.helpful_count,
            attachments: review.attachments,
            createdAt: review.created_at.toISOString(),
          }
        : null,
    };
  }

  /** POST /admin/tutoring/bookings/:id/cancel — force cancel + notify 2 bên. */
  async cancelBooking(ctx: AdminContext, id: string, reason: string) {
    const result = await this.audit.withAudit(
      ctx,
      'booking.force_cancel',
      { type: 'booking', id },
      async () => {
        const before = await this.prisma.tutoring_booking.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
            student_id: true,
            tutor_id: true,
            start_at: true,
          },
        });
        if (!before) throw new Error('Booking not found');
        if (before.status === 'CANCELLED') throw new Error('Booking đã bị huỷ');
        if (before.status === 'COMPLETED')
          throw new Error('Booking đã hoàn thành, không huỷ được');

        const now = new Date();
        await this.prisma.tutoring_booking.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            cancelled_at: now,
            cancelled_by: ctx.userId,
            cancel_reason: reason,
          },
        });

        // Lookup tutor userId để notify
        const tutor = await this.prisma.tutor_profile.findUnique({
          where: { id: before.tutor_id },
          select: { user_id: true },
        });

        return {
          before: {
            id: before.id,
            status: before.status,
            studentId: before.student_id,
            tutorId: before.tutor_id,
            startAt: before.start_at,
          },
          after: { status: 'CANCELLED', cancelledBy: ctx.userId, cancelReason: reason },
          reason,
          result: {
            ok: true,
            tutorUserId: tutor?.user_id ?? null,
            studentUserId: before.student_id,
          },
        };
      },
    );

    // Fire-and-forget notify cả 2 bên — KHÔNG xoá study_group đã tạo, KHÔNG
    // tự refund (admin gọi /refund riêng).
    const notifyRows: Prisma.notification_logCreateManyInput[] = [];
    if (result.tutorUserId) {
      notifyRows.push({
        id: randomUUID(),
        user_id: result.tutorUserId,
        type: 'admin-booking-cancel',
        title: 'Booking bị huỷ bởi admin',
        body: `Buổi dạy đã bị huỷ. Lý do: ${reason}`,
        data: { bookingId: id, role: 'tutor', reason },
        status: 'pending',
      });
    }
    notifyRows.push({
      id: randomUUID(),
      user_id: result.studentUserId,
      type: 'admin-booking-cancel',
      title: 'Booking bị huỷ bởi admin',
      body: `Buổi học đã bị huỷ. Lý do: ${reason}`,
      data: { bookingId: id, role: 'student', reason },
      status: 'pending',
    });
    void this.prisma.notification_log.createMany({ data: notifyRows }).catch((err) => {
      console.error('[admin booking.cancel notify] fail:', err);
    });

    return { ok: true };
  }

  /** POST /admin/tutoring/bookings/:id/refund — STUB flip status, SUPER_ADMIN only. */
  async refundBooking(ctx: AdminContext, id: string, body: RefundInput) {
    const { amountVnd: requestedAmount, reason } = body;

    const result = await this.audit.withAudit(
      ctx,
      'booking.refund',
      { type: 'booking', id },
      async () => {
        const booking = await this.prisma.tutoring_booking.findUnique({
          where: { id },
          select: { student_id: true },
        });
        if (!booking) throw new Error('Booking not found');

        const payment = await this.prisma.tutoring_payment.findUnique({
          where: { booking_id: id },
        });
        if (!payment) throw new Error('Booking chưa có payment');
        if (payment.status !== 'CAPTURED') {
          throw new Error(`Không refund được — payment status=${payment.status}`);
        }

        const refundAmount = requestedAmount ?? payment.amount_vnd;
        if (refundAmount > payment.amount_vnd) {
          throw new Error('Refund amount vượt amount gốc');
        }

        await this.prisma.tutoring_payment.update({
          where: { id: payment.id },
          data: { status: 'REFUNDED', refunded_at: new Date() },
        });

        return {
          before: { paymentStatus: payment.status, amountVnd: payment.amount_vnd },
          after: {
            paymentStatus: 'REFUNDED',
            refundAmountVnd: refundAmount,
            partial: refundAmount < payment.amount_vnd,
          },
          reason,
          metadata: { provider: payment.provider, providerRef: payment.provider_ref },
          result: { ok: true, studentId: booking.student_id, refundAmount },
        };
      },
    );

    // Notify student
    void this.prisma.notification_log
      .create({
        data: {
          id: randomUUID(),
          user_id: result.studentId,
          type: 'admin-booking-refund',
          title: 'Đã hoàn tiền cho booking',
          body: `Bạn được hoàn ${result.refundAmount.toLocaleString('vi-VN')}₫. Lý do: ${reason}`,
          data: { bookingId: id, refundAmount: result.refundAmount, reason },
          status: 'pending',
        },
      })
      .catch((err) => console.error('[admin booking.refund notify] fail:', err));

    return { ok: true, refundAmount: result.refundAmount };
  }

  /* ── Reviews ───────────────────────────────────────────────────────────── */

  /** GET /admin/tutoring/reviews — visibility/rating/q + hiddenCount badge. */
  async listReviews(params: {
    visibility?: string;
    rating?: string;
    q?: string;
    cursor?: string;
    limit?: string;
  }) {
    const visibility = params.visibility ?? 'visible';
    const ratingRaw = Number(params.rating);
    const rating =
      Number.isFinite(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5
        ? Math.floor(ratingRaw)
        : null;
    const q = params.q?.trim() ?? '';
    const limit = clampLimit(params.limit, 50, 100);

    const where: Prisma.tutor_reviewWhereInput = {};
    if (visibility === 'visible') where.hidden_at = null;
    else if (visibility === 'hidden') where.hidden_at = { not: null };
    if (rating !== null) where.rating = rating;
    if (q) {
      where.OR = [
        { comment: { contains: q, mode: 'insensitive' } },
        { tutor_profile: { user: { email: { contains: q, mode: 'insensitive' } } } },
        {
          user_tutor_review_reviewer_idTouser: {
            email: { contains: q, mode: 'insensitive' },
          },
        },
      ];
    }
    const cursorDate = parseCursor(params.cursor);
    if (cursorDate) where.created_at = { lt: cursorDate };

    const [rows, hiddenCount] = await Promise.all([
      this.prisma.tutor_review.findMany({
        where,
        select: {
          id: true,
          booking_id: true,
          rating: true,
          comment: true,
          created_at: true,
          hidden_at: true,
          hidden_reason: true,
          hidden_by: true,
          tutor_id: true,
          reviewer_id: true,
          tutor_profile: {
            select: { user_id: true, user: { select: { name: true, email: true } } },
          },
          user_tutor_review_reviewer_idTouser: {
            select: { name: true, email: true, image: true },
          },
        },
        orderBy: { created_at: 'desc' },
        take: limit + 1,
      }),
      // Hidden count for badge — luôn trả (y route cũ)
      this.prisma.tutor_review.count({ where: { hidden_at: { not: null } } }),
    ]);

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && trimmed.length > 0
        ? trimmed[trimmed.length - 1]!.created_at.toISOString()
        : null;

    return {
      reviews: trimmed.map((r) => ({
        id: r.id,
        bookingId: r.booking_id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.created_at.toISOString(),
        hiddenAt: r.hidden_at?.toISOString() ?? null,
        hiddenReason: r.hidden_reason,
        hiddenBy: r.hidden_by,
        tutorProfileId: r.tutor_id,
        tutorUserId: r.tutor_profile.user_id,
        tutorName: r.tutor_profile.user.name,
        tutorEmail: r.tutor_profile.user.email,
        reviewerId: r.reviewer_id,
        reviewerName: r.user_tutor_review_reviewer_idTouser.name,
        reviewerEmail: r.user_tutor_review_reviewer_idTouser.email,
        reviewerImage: r.user_tutor_review_reviewer_idTouser.image,
      })),
      nextCursor,
      hiddenCount,
    };
  }

  /** POST /admin/tutoring/reviews/:id/hide — set hidden_at + notify reviewer. */
  async hideReview(ctx: AdminContext, id: string, reason: string) {
    const result = await this.audit.withAudit(
      ctx,
      'review.hide',
      { type: 'review', id },
      async () => {
        const before = await this.prisma.tutor_review.findUnique({
          where: { id },
          select: { id: true, hidden_at: true, reviewer_id: true, rating: true },
        });
        if (!before) throw new Error('Review not found');
        if (before.hidden_at) throw new Error('Review đã hidden rồi');

        const now = new Date();
        await this.prisma.tutor_review.update({
          where: { id },
          data: { hidden_at: now, hidden_reason: reason, hidden_by: ctx.userId },
        });

        return {
          before: { hiddenAt: null },
          after: { hiddenAt: now.toISOString(), hiddenReason: reason, hiddenBy: ctx.userId },
          reason,
          result: { ok: true, reviewerId: before.reviewer_id },
        };
      },
    );

    // Notify reviewer biết review của họ bị hide (giúp họ tránh vi phạm tiếp)
    void this.prisma.notification_log
      .create({
        data: {
          id: randomUUID(),
          user_id: result.reviewerId,
          type: 'admin-review-hide',
          title: 'Review của bạn đã bị ẩn',
          body: `Lý do: ${reason}`,
          data: { reviewId: id, reason },
          status: 'pending',
        },
      })
      .catch((err) => console.error('[admin review.hide notify] fail:', err));

    return { ok: true };
  }

  /** POST /admin/tutoring/reviews/:id/restore — clear hidden_*, không notify. */
  async restoreReview(ctx: AdminContext, id: string, reason: string) {
    await this.audit.withAudit(ctx, 'review.restore', { type: 'review', id }, async () => {
      const before = await this.prisma.tutor_review.findUnique({
        where: { id },
        select: { hidden_at: true },
      });
      if (!before) throw new Error('Review not found');
      if (!before.hidden_at) throw new Error('Review không bị hidden');

      await this.prisma.tutor_review.update({
        where: { id },
        data: { hidden_at: null, hidden_reason: null, hidden_by: null },
      });

      return {
        before: { hiddenAt: before.hidden_at.toISOString() },
        after: { hiddenAt: null },
        reason,
        result: { ok: true },
      };
    });

    return { ok: true };
  }
}
