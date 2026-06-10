/**
 * POST /api/tutoring/bookings/[id]/cancel — student hoặc tutor huỷ booking.
 *
 * Policy:
 *   - PENDING_TUTOR  → cả 2 huỷ free
 *   - CONFIRMED      → policy 24h (helper evaluateCancelPolicy)
 *   - IN_PROGRESS    → không huỷ (đã bắt đầu)
 *   - COMPLETED/CANCELLED → idempotent error
 *
 * Body: { reason?: string }
 *
 * Nếu có payment CAPTURED → set status REFUNDED (stub refund — V3 wire
 * thật khi VNPay active).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorProfile,
  tutoringBooking,
  tutoringPayment,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onTutoringMineChanged } from '@/lib/cache/invalidate';
import { createNotification } from '@/lib/notifications/notify';
import { evaluateCancelPolicy } from '@/lib/tutoring/booking-helpers';
import { refundPayment } from '@/lib/tutoring/payment-provider';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const SCHEMA = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: tutoringBooking.id,
      status: tutoringBooking.status,
      studentId: tutoringBooking.studentId,
      startAt: tutoringBooking.startAt,
      rateVnd: tutoringBooking.rateVnd,
      tutorUserId: tutorProfile.userId,
    })
    .from(tutoringBooking)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
    .where(eq(tutoringBooking.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isStudent = row.studentId === userId;
  const isTutor = row.tutorUserId === userId;
  if (!isStudent && !isTutor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (row.status === 'COMPLETED' || row.status === 'CANCELLED') {
    return NextResponse.json(
      { error: `Booking đã ${row.status}` },
      { status: 400 },
    );
  }
  if (row.status === 'IN_PROGRESS') {
    return NextResponse.json(
      { error: 'Buổi đã bắt đầu — không huỷ được' },
      { status: 400 },
    );
  }

  // Apply policy chỉ với CONFIRMED — PENDING_TUTOR luôn free.
  let policyNote: string | null = null;
  if (row.status === 'CONFIRMED') {
    const policy = evaluateCancelPolicy(row.startAt, row.rateVnd);
    if (!policy.allowed) {
      return NextResponse.json({ error: policy.reason }, { status: 400 });
    }
    policyNote = policy.reason;
  }

  // Lookup payment để gọi refund nếu đã CAPTURED (chỉ provider thật cần)
  const [pay] = await db
    .select({
      id: tutoringPayment.id,
      provider: tutoringPayment.provider,
      status: tutoringPayment.status,
      orderCode: tutoringPayment.orderCode,
      providerRef: tutoringPayment.providerRef,
      amountVnd: tutoringPayment.amountVnd,
    })
    .from(tutoringPayment)
    .where(eq(tutoringPayment.bookingId, row.id))
    .limit(1);

  // Gọi provider refund (ngoài transaction để fetch HTTP không block lock).
  // STUB: ok ngay; VNPAY/MOMO: call API, nếu fail → trả về error nhưng vẫn
  // cancel booking (admin sẽ refund manual + flag DB sau).
  let refundNote: string | null = null;
  let refundOk = true;
  if (pay && pay.status === 'CAPTURED') {
    const refund = await refundPayment({
      provider: pay.provider as 'STUB' | 'VNPAY' | 'MOMO',
      orderCode: pay.orderCode,
      providerRef: pay.providerRef,
      amountVnd: pay.amountVnd,
      reason: parsed.data.reason ?? 'Booking cancelled',
      initiatedBy: session.user.email ?? userId,
    });
    refundOk = refund.ok;
    refundNote = refund.message;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(tutoringBooking)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancelReason: parsed.data.reason ?? null,
      })
      .where(eq(tutoringBooking.id, row.id));

    if (pay && pay.status === 'CAPTURED' && refundOk) {
      // Provider OK → flag DB REFUNDED. Nếu refund fail trên VNPay/MoMo →
      // giữ status cũ, admin sẽ xử lý manual (refundNote trả về client).
      await tx
        .update(tutoringPayment)
        .set({
          status: 'REFUNDED',
          refundedAt: new Date(),
        })
        .where(eq(tutoringPayment.id, pay.id));
    }
  });

  // Booking CANCELLED đổi "Đơn học sắp tới" của CẢ student + tutor → xoá cache mine cả hai.
  await onTutoringMineChanged(row.studentId);
  await onTutoringMineChanged(row.tutorUserId);

  // Thông báo cho bên CÒN LẠI (người không bấm huỷ) — realtime.
  const recipientUserId = isStudent ? row.tutorUserId : row.studentId;
  void createNotification({
    userId: recipientUserId,
    type: 'booking-cancelled',
    title: 'Buổi học đã bị huỷ',
    body: parsed.data.reason
      ? `Lý do: ${parsed.data.reason}`
      : `${isStudent ? 'Học viên' : 'Gia sư'} đã huỷ buổi học.`,
    data: { bookingId: row.id, role: isStudent ? 'tutor' : 'student' },
  }).catch((e) => console.error('[booking.cancel notify]', e));

  return NextResponse.json({
    ok: true,
    policyNote,
    refund: pay ? { ok: refundOk, message: refundNote } : null,
  });
}
