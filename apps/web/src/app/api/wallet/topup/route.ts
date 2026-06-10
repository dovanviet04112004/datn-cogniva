/**
 * POST /api/wallet/topup — V4 T3 (2026-05-22).
 *
 * Tạo intent nạp tiền qua provider (VNPay/MoMo/STUB).
 * Sau khi provider callback → topupWallet() được gọi từ webhook.
 *
 * STUB dev: auto-capture ngay (no real payment) → hữu ích test wallet.
 *
 * Body: { amountVnd: number, provider?: 'VNPAY' | 'MOMO' | 'STUB' }
 *
 * Spec: docs/plans/tutoring-v4.md §6.1.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { topupWallet } from '@/lib/tutoring/wallet';

export const runtime = 'nodejs';

const BODY_SCHEMA = z.object({
  amountVnd: z.number().int().min(10000).max(50_000_000),
  provider: z.enum(['VNPAY', 'MOMO', 'STUB']).optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const provider =
    parsed.data.provider ?? (process.env.PAYMENT_PROVIDER ?? 'STUB');

  // STUB: auto-credit ngay (dev)
  if (provider === 'STUB') {
    const { txnId, cashback } = await topupWallet({
      userId: session.user.id,
      amountVnd: parsed.data.amountVnd,
      description: `Dev STUB nạp ${parsed.data.amountVnd.toLocaleString('vi-VN')}đ`,
    });
    return NextResponse.json({
      provider: 'STUB',
      txnId,
      cashback,
      autoCredited: true,
    });
  }

  // VNPAY/MoMo: tạo intent + redirect URL
  // Tích hợp với payment-provider helper của V3 (hiện gắn cho booking).
  // V4 T3.1: extend `buildTopupIntent()` riêng — tạm trả error chờ wire.
  return NextResponse.json(
    {
      error:
        'Provider VNPAY/MoMo cho wallet topup chưa wire. Set PAYMENT_PROVIDER=STUB ở .env.local để test dev.',
    },
    { status: 501 },
  );
}
