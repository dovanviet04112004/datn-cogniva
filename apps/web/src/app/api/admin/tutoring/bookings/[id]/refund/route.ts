/**
 * POST /api/admin/tutoring/bookings/[id]/refund — admin refund 1 payment.
 *
 * Body:
 *   amountVnd?: number  — refund partial; nếu omitted = full refund (amountVnd của payment)
 *   reason:     string  — bắt buộc, 10..500 chars
 *
 * Logic:
 *   1. Payment phải tồn tại + status CAPTURED (chưa refund). Status khác → 400.
 *   2. amountVnd ≤ payment.amountVnd.
 *   3. Update payment.status = 'REFUNDED' + refundedAt = NOW.
 *   4. Phase 4 V1: KHÔNG gọi VNPAY/MOMO API thật — admin manual xử lý ngoài.
 *      Provider STUB: chỉ flip status.
 *   5. Notify student qua notification_log.
 *
 * Auth: SUPER_ADMIN only (refund động tới tiền, cần restrict thêm).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  notificationLog,
  tutoringBooking,
  tutoringPayment,
} from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const BODY_SCHEMA = z.object({
  amountVnd: z.number().int().positive().optional(),
  reason: z.string().trim().min(10).max(500),
});

export async function POST(request: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { amountVnd: requestedAmount, reason } = parsed.data;

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'booking.refund',
    { type: 'booking', id },
    async () => {
      const [booking] = await db
        .select({ studentId: tutoringBooking.studentId })
        .from(tutoringBooking)
        .where(eq(tutoringBooking.id, id))
        .limit(1);
      if (!booking) throw new Error('Booking not found');

      const [payment] = await db
        .select()
        .from(tutoringPayment)
        .where(eq(tutoringPayment.bookingId, id))
        .limit(1);
      if (!payment) throw new Error('Booking chưa có payment');
      if (payment.status !== 'CAPTURED') {
        throw new Error(`Không refund được — payment status=${payment.status}`);
      }

      const refundAmount = requestedAmount ?? payment.amountVnd;
      if (refundAmount > payment.amountVnd) {
        throw new Error('Refund amount vượt amount gốc');
      }

      const now = new Date();
      await db
        .update(tutoringPayment)
        .set({ status: 'REFUNDED', refundedAt: now })
        .where(eq(tutoringPayment.id, payment.id));

      return {
        before: { paymentStatus: payment.status, amountVnd: payment.amountVnd },
        after: {
          paymentStatus: 'REFUNDED',
          refundAmountVnd: refundAmount,
          partial: refundAmount < payment.amountVnd,
        },
        reason,
        metadata: { provider: payment.provider, providerRef: payment.providerRef },
        result: { ok: true, studentId: booking.studentId, refundAmount },
      };
    },
  );

  // Notify student
  void db
    .insert(notificationLog)
    .values({
      userId: result.studentId,
      type: 'admin-booking-refund',
      title: 'Đã hoàn tiền cho booking',
      body: `Bạn được hoàn ${result.refundAmount.toLocaleString('vi-VN')}₫. Lý do: ${reason}`,
      data: { bookingId: id, refundAmount: result.refundAmount, reason },
      status: 'pending',
    })
    .catch((err) => console.error('[admin booking.refund notify] fail:', err));

  return NextResponse.json({ ok: true, refundAmount: result.refundAmount });
}
