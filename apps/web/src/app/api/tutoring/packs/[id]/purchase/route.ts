/**
 * POST /api/tutoring/packs/[id]/purchase — V4 T3 (2026-05-22).
 *
 * Student mua pack:
 *   1. Validate pack ACTIVE + giá khớp
 *   2. Charge wallet (hoặc tạo VNPay intent nếu balance không đủ — V4.1)
 *   3. Tạo tutoring_pack_purchase với remaining_sessions = sessionCount
 *   4. Optional installment: nếu body.installmentPeriods set → chỉ charge 1/N kỳ
 *
 * Body: { installmentPeriods?: 2 | 3 | 4, recurringSchedule?: string }
 *
 * Spec: docs/plans/tutoring-v4.md §6.2.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutoringPack,
  tutoringPackPurchase,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import {
  chargeWallet,
  InsufficientBalanceError,
} from '@/lib/tutoring/wallet';

export const runtime = 'nodejs';

const BODY_SCHEMA = z.object({
  installmentPeriods: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  recurringSchedule: z.string().max(50).optional(),
});

const PACK_EXPIRES_DAYS = 90;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: packId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [pack] = await db
    .select()
    .from(tutoringPack)
    .where(eq(tutoringPack.id, packId))
    .limit(1);
  if (!pack || pack.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Pack không khả dụng' }, { status: 404 });
  }

  // Chia kỳ — kỳ đầu charge ngay
  const totalPeriods = parsed.data.installmentPeriods;
  const periodAmount = totalPeriods
    ? Math.ceil(pack.totalVnd / totalPeriods)
    : pack.totalVnd;

  // Charge wallet kỳ đầu
  let chargeResult: Awaited<ReturnType<typeof chargeWallet>>;
  try {
    chargeResult = await chargeWallet({
      userId: session.user.id,
      amountVnd: periodAmount,
      type: 'PACK_PURCHASE',
      relatedType: 'pack',
      relatedId: packId,
      description: totalPeriods
        ? `Pack ${pack.sessionCount} buổi — kỳ 1/${totalPeriods}`
        : `Pack ${pack.sessionCount} buổi`,
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json(
        {
          error: 'Số dư wallet không đủ — nạp thêm để mua pack',
          required: err.required,
          available: err.available,
        },
        { status: 402 },
      );
    }
    throw err;
  }

  // Tạo purchase row
  const [purchase] = await db
    .insert(tutoringPackPurchase)
    .values({
      packId: pack.id,
      studentId: session.user.id,
      totalVnd: pack.totalVnd,
      remainingSessions: pack.sessionCount,
      installmentTotalPeriods: totalPeriods,
      installmentPaidPeriods: totalPeriods ? 1 : 0,
      recurringSchedule: parsed.data.recurringSchedule,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + PACK_EXPIRES_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning();

  return NextResponse.json(
    {
      purchase,
      chargedAmount: periodAmount,
      walletTxnId: chargeResult.txnId,
      installmentPeriods: totalPeriods ?? null,
    },
    { status: 201 },
  );
}
