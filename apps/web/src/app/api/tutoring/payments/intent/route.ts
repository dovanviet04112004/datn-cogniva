/**
 * POST /api/tutoring/payments/intent — student tạo payment intent cho booking.
 *
 * Body: { bookingId }
 *
 * Logic:
 *   1. Validate booking thuộc về user + status PENDING_TUTOR hoặc CONFIRMED
 *   2. Kiểm tra đã có payment row chưa — nếu CAPTURED thì idempotent return
 *   3. Tạo orderCode unique + insert payment row status CREATED
 *   4. Gọi provider (STUB|VNPAY|MOMO) build URL thanh toán
 *   5. Trả về { paymentUrl, paymentId, orderCode, provider }
 *
 * Khi provider STUB, paymentUrl trỏ về `/tutoring/bookings/[id]?paid=1` —
 * FE đọc `paid=1` thì tự gọi /capture endpoint để mark CAPTURED.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutoringBooking,
  tutoringPayment,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { createPaymentIntent } from '@/lib/tutoring/payment-provider';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  bookingId: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [booking] = await db
    .select({
      id: tutoringBooking.id,
      status: tutoringBooking.status,
      studentId: tutoringBooking.studentId,
      rateVnd: tutoringBooking.rateVnd,
      subjectSlug: tutoringBooking.subjectSlug,
    })
    .from(tutoringBooking)
    .where(eq(tutoringBooking.id, parsed.data.bookingId))
    .limit(1);

  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (booking.studentId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
    return NextResponse.json(
      { error: `Booking ${booking.status} — không tạo intent` },
      { status: 400 },
    );
  }

  // Idempotent — nếu payment CAPTURED rồi return URL stub luôn
  const [existing] = await db
    .select()
    .from(tutoringPayment)
    .where(eq(tutoringPayment.bookingId, booking.id))
    .limit(1);

  if (existing && existing.status === 'CAPTURED') {
    return NextResponse.json({
      paymentId: existing.id,
      paymentUrl: null,
      orderCode: existing.orderCode,
      provider: existing.provider,
      reused: true,
      already: 'CAPTURED',
    });
  }

  // Build orderCode unique
  const orderCode = existing?.orderCode
    ?? `BK-${booking.id.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;

  // Insert/upsert payment row
  let paymentId: string;
  if (existing) {
    paymentId = existing.id;
    await db
      .update(tutoringPayment)
      .set({ status: 'CREATED' })
      .where(eq(tutoringPayment.id, paymentId));
  } else {
    const [created] = await db
      .insert(tutoringPayment)
      .values({
        bookingId: booking.id,
        amountVnd: booking.rateVnd,
        feeVnd: Math.round(booking.rateVnd * 0.1),
        provider: 'STUB',
        orderCode,
        status: 'CREATED',
      })
      .returning();
    paymentId = created!.id;
  }

  // Call provider
  const origin = new URL(request.url).origin;
  const returnUrl = `${origin}/tutoring/bookings/${booking.id}`;
  const intent = await createPaymentIntent({
    orderCode,
    amountVnd: booking.rateVnd,
    description: `Cogniva tutoring booking ${booking.id.slice(0, 8)}`,
    returnUrl,
  });

  // Update payment row with resolved provider + raw request
  await db
    .update(tutoringPayment)
    .set({
      provider: intent.resolvedProvider,
      rawResponse: { request: intent.rawRequest },
    })
    .where(eq(tutoringPayment.id, paymentId));

  return NextResponse.json({
    paymentId,
    paymentUrl: intent.paymentUrl,
    orderCode,
    provider: intent.resolvedProvider,
  });
}
