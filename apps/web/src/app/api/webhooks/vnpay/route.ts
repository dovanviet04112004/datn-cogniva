/**
 * POST/GET /api/webhooks/vnpay — VNPay IPN + return-URL handler.
 *
 * VNPay gọi 2 lần:
 *   1. ReturnUrl (browser redirect, GET) — UX confirm cho user.
 *   2. IPN URL (server-to-server, POST or GET) — authoritative status.
 *
 * Logic:
 *   1. Verify HMAC signature.
 *   2. Lookup payment theo orderCode (vnp_TxnRef).
 *   3. Map vnp_ResponseCode → CAPTURED / FAILED.
 *   4. Idempotent — không double-capture.
 *
 * Khi VNPAY credentials chưa setup → return 503 (caller phải dùng STUB).
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db, tutoringPayment } from '@cogniva/db';

import { verifyVnpaySignature } from '@/lib/tutoring/payment-provider';

export const runtime = 'nodejs';

function paramsFromUrl(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams) out[k] = v;
  return out;
}

async function paramsFromBody(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const json = await req.json().catch(() => ({}));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(json)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData();
    const out: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  return {};
}

async function handle(params: Record<string, string>) {
  if (!process.env.VNPAY_HASH_SECRET) {
    return NextResponse.json(
      { error: 'VNPay chưa cấu hình — env VNPAY_HASH_SECRET thiếu' },
      { status: 503 },
    );
  }

  if (!verifyVnpaySignature(params)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const orderCode = params['vnp_TxnRef'];
  const respCode = params['vnp_ResponseCode'];
  if (!orderCode || !respCode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const [pay] = await db
    .select()
    .from(tutoringPayment)
    .where(eq(tutoringPayment.orderCode, orderCode))
    .limit(1);

  if (!pay) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  // Idempotent
  if (pay.status === 'CAPTURED' && respCode === '00') {
    return NextResponse.json({ ok: true, already: 'CAPTURED' });
  }

  // ResponseCode '00' = success; mọi khác = fail
  const newStatus = respCode === '00' ? 'CAPTURED' : 'FAILED';
  await db
    .update(tutoringPayment)
    .set({
      status: newStatus,
      providerRef: params['vnp_TransactionNo'] ?? null,
      capturedAt: newStatus === 'CAPTURED' ? new Date() : null,
      rawResponse: { ipn: params },
    })
    .where(eq(tutoringPayment.id, pay.id));

  return NextResponse.json({ ok: true, status: newStatus });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return handle(paramsFromUrl(url));
}

export async function POST(request: Request) {
  return handle(await paramsFromBody(request));
}
