/**
 * POST /api/tutoring/payments/[id]/capture — capture payment.
 *
 * Trong mode STUB, FE gọi endpoint này sau khi user click "Thanh toán"
 * (return URL có `?stub=1`). Mark payment CAPTURED + set escrowReleaseAt.
 *
 * Trong mode VNPAY thật, capture xảy ra qua webhook /api/webhooks/vnpay
 * — endpoint này chỉ dùng cho STUB.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import {
  db,
  tutoringBooking,
  tutoringPayment,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  const [pay] = await db
    .select({
      id: tutoringPayment.id,
      bookingId: tutoringPayment.bookingId,
      provider: tutoringPayment.provider,
      status: tutoringPayment.status,
      orderCode: tutoringPayment.orderCode,
      studentId: tutoringBooking.studentId,
    })
    .from(tutoringPayment)
    .innerJoin(tutoringBooking, eq(tutoringBooking.id, tutoringPayment.bookingId))
    .where(eq(tutoringPayment.id, id))
    .limit(1);

  if (!pay) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (pay.studentId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (pay.provider !== 'STUB') {
    return NextResponse.json(
      {
        error: `Capture endpoint chỉ cho STUB. Provider ${pay.provider} dùng webhook.`,
      },
      { status: 400 },
    );
  }
  if (pay.status === 'CAPTURED') {
    return NextResponse.json({ ok: true, already: 'CAPTURED' });
  }
  if (pay.status === 'REFUNDED' || pay.status === 'FAILED') {
    return NextResponse.json(
      { error: `Payment ${pay.status}, không capture được` },
      { status: 400 },
    );
  }

  await db
    .update(tutoringPayment)
    .set({
      status: 'CAPTURED',
      capturedAt: new Date(),
      providerRef: `stub-${Date.now()}`,
    })
    .where(eq(tutoringPayment.id, pay.id));

  return NextResponse.json({ ok: true, captured: true });
}
