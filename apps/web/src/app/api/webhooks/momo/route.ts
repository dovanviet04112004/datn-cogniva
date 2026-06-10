/**
 * POST /api/webhooks/momo — MoMo IPN handler.
 *
 * MoMo gửi JSON body với HMAC SHA256 signature. Verify signature, lookup
 * payment theo orderId, map resultCode → CAPTURED / FAILED.
 *
 * Khi env MOMO_SECRET_KEY chưa setup → 503 (caller phải dùng STUB).
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';

import { db, tutoringPayment } from '@cogniva/db';

export const runtime = 'nodejs';

type MomoIpn = {
  partnerCode?: string;
  orderId?: string;
  requestId?: string;
  amount?: number;
  orderInfo?: string;
  orderType?: string;
  transId?: number;
  resultCode?: number;
  message?: string;
  payType?: string;
  responseTime?: number;
  extraData?: string;
  signature?: string;
};

function verifySignature(body: MomoIpn): boolean {
  const secret = process.env.MOMO_SECRET_KEY;
  const accessKey = process.env.MOMO_ACCESS_KEY;
  if (!secret || !accessKey || !body.signature) return false;

  // Raw signature theo IPN spec MoMo
  const raw
    = `accessKey=${accessKey}`
    + `&amount=${body.amount}`
    + `&extraData=${body.extraData ?? ''}`
    + `&message=${body.message ?? ''}`
    + `&orderId=${body.orderId}`
    + `&orderInfo=${body.orderInfo ?? ''}`
    + `&orderType=${body.orderType ?? ''}`
    + `&partnerCode=${body.partnerCode}`
    + `&payType=${body.payType ?? ''}`
    + `&requestId=${body.requestId}`
    + `&responseTime=${body.responseTime}`
    + `&resultCode=${body.resultCode}`
    + `&transId=${body.transId}`;

  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  return expected === body.signature;
}

export async function POST(request: Request) {
  if (!process.env.MOMO_SECRET_KEY) {
    return NextResponse.json(
      { error: 'MoMo chưa cấu hình — env MOMO_SECRET_KEY thiếu' },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as MomoIpn | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!verifySignature(body)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (!body.orderId || body.resultCode === undefined) {
    return NextResponse.json({ error: 'Missing orderId / resultCode' }, { status: 400 });
  }

  const [pay] = await db
    .select()
    .from(tutoringPayment)
    .where(eq(tutoringPayment.orderCode, body.orderId))
    .limit(1);

  if (!pay) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  // Idempotent
  if (pay.status === 'CAPTURED' && body.resultCode === 0) {
    return NextResponse.json({ ok: true, already: 'CAPTURED' });
  }

  const newStatus = body.resultCode === 0 ? 'CAPTURED' : 'FAILED';
  await db
    .update(tutoringPayment)
    .set({
      status: newStatus,
      providerRef: body.transId ? String(body.transId) : null,
      capturedAt: newStatus === 'CAPTURED' ? new Date() : null,
      rawResponse: { ipn: body as unknown as Record<string, unknown> },
    })
    .where(eq(tutoringPayment.id, pay.id));

  // MoMo expect response 204 No Content (theo spec) — Next.js trả 200 cũng OK
  return NextResponse.json({ ok: true, status: newStatus });
}
