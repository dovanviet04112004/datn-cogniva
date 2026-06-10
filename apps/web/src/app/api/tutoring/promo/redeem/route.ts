/**
 * POST /api/tutoring/promo/redeem — V4 T3 (2026-05-22).
 *
 * User nhập promo code → apply theo type:
 *   - PERCENTAGE / FIXED_VND: trả discount info để FE apply lúc thanh toán
 *   - WALLET_CREDIT: thêm vào promoBalance ngay
 *
 * Validate:
 *   - Code tồn tại + còn valid window
 *   - uses_count < max_uses (nếu set)
 *   - user chưa redeem quá per_user_limit
 *
 * Body: { code: string }
 *
 * Spec: docs/plans/tutoring-v4.md §3 T3.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  promoCode,
  promoCodeRedemption,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { applyPromoCredit } from '@/lib/tutoring/wallet';

export const runtime = 'nodejs';

const BODY_SCHEMA = z.object({
  code: z.string().min(1).max(50),
});

const WALLET_CREDIT_EXPIRY_DAYS = 60;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const code = parsed.data.code.trim().toUpperCase();

  const [promo] = await db
    .select()
    .from(promoCode)
    .where(eq(promoCode.code, code))
    .limit(1);

  if (!promo) {
    return NextResponse.json({ error: 'Mã không hợp lệ' }, { status: 404 });
  }

  const now = new Date();
  if (promo.validFrom && promo.validFrom > now) {
    return NextResponse.json({ error: 'Mã chưa kích hoạt' }, { status: 400 });
  }
  if (promo.validUntil && promo.validUntil < now) {
    return NextResponse.json({ error: 'Mã đã hết hạn' }, { status: 400 });
  }
  if (promo.maxUses != null && promo.usesCount >= promo.maxUses) {
    return NextResponse.json({ error: 'Mã đã hết lượt' }, { status: 400 });
  }

  // Check per-user limit
  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(promoCodeRedemption)
    .where(
      and(
        eq(promoCodeRedemption.promoCode, code),
        eq(promoCodeRedemption.userId, session.user.id),
      ),
    );
  if (existing && existing.count >= promo.perUserLimit) {
    return NextResponse.json(
      { error: `Bạn đã dùng mã này ${promo.perUserLimit} lần — không thể dùng tiếp` },
      { status: 400 },
    );
  }

  // Apply theo type — chỉ WALLET_CREDIT auto-apply ngay; còn lại trả info
  if (promo.type === 'WALLET_CREDIT') {
    const expires = new Date(
      Date.now() + WALLET_CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    await applyPromoCredit({
      userId: session.user.id,
      amountVnd: promo.value,
      expiresAt: expires,
      relatedId: code,
      description: `Promo ${code} +${promo.value.toLocaleString('vi-VN')}đ wallet credit`,
    });

    // Update redemption + uses_count
    await db.transaction(async (tx) => {
      await tx.insert(promoCodeRedemption).values({
        promoCode: code,
        userId: session.user.id,
        amountVnd: promo.value,
      });
      await tx
        .update(promoCode)
        .set({ usesCount: sql`${promoCode.usesCount} + 1` })
        .where(eq(promoCode.code, code));
    });

    return NextResponse.json({
      type: 'WALLET_CREDIT',
      creditedVnd: promo.value,
      expiresAt: expires,
      message: `Đã cộng ${promo.value.toLocaleString('vi-VN')}đ vào wallet credit`,
    });
  }

  // PERCENTAGE / FIXED_VND — trả info để FE apply lúc checkout
  // Persist redemption pending (amount=0) để track. Khi checkout sẽ update amount.
  await db
    .insert(promoCodeRedemption)
    .values({ promoCode: code, userId: session.user.id, amountVnd: 0 })
    .onConflictDoNothing();

  return NextResponse.json({
    type: promo.type,
    value: promo.value,
    minPurchaseVnd: promo.minPurchaseVnd,
    message:
      promo.type === 'PERCENTAGE'
        ? `Mã giảm ${promo.value}% — apply lúc thanh toán`
        : `Mã giảm ${promo.value.toLocaleString('vi-VN')}đ — apply lúc thanh toán`,
  });
}
