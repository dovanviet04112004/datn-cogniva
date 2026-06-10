/**
 * POST /api/library/cancel-pro — Phase 5 (2026-05-27).
 *
 * Cancel PRO subscription + refund prorated phần thời gian chưa dùng vào wallet.
 *
 * Công thức prorate:
 *   remainingDays  = max(0, (proUntilAt - now) / 1 day)
 *   refundRatio    = remainingDays / 30          // 1 chu kỳ subscription
 *   refundVnd      = round(remainingDays / 30 * 199_000)
 *   nhưng cap theo TỔNG đã charge gần nhất qua PRO_SUBSCRIPTION ledger
 *   (tránh refund > đã trả khi user gia hạn nhiều lần).
 *
 * Side effects:
 *   - user.plan = 'FREE', proUntilAt = NOW() (hết hạn ngay)
 *   - refundToWallet(refundVnd) — type 'REFUND' với relatedType='library_pro'
 *
 * Khi proUntilAt đã quá hạn → không refund, vẫn flip plan='FREE' idempotent.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, gte } from 'drizzle-orm';

import { db, user as userTable, userWalletTxn } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { refundToWallet } from '@/lib/tutoring/wallet';

export const runtime = 'nodejs';

const MONTHLY_PRICE_VND = 199_000;
const MONTH_DAYS = 30;

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const [row] = await db
    .select({ plan: userTable.plan, proUntilAt: userTable.proUntilAt })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const now = new Date();
  const isActive = row.plan === 'PRO' && row.proUntilAt && row.proUntilAt > now;

  // Idempotent — đã hết hạn / FREE thì flip plan và trả 0đ refund
  if (!isActive) {
    if (row.plan === 'PRO') {
      await db
        .update(userTable)
        .set({ plan: 'FREE', updatedAt: new Date() })
        .where(eq(userTable.id, userId));
    }
    return NextResponse.json({
      ok: true,
      refunded: 0,
      reason: 'pro_inactive',
    });
  }

  // Tính prorate dựa trên thời gian còn lại
  const remainingMs = row.proUntilAt!.getTime() - now.getTime();
  const remainingDays = remainingMs / 86400_000;
  const rawRefund = Math.round((remainingDays / MONTH_DAYS) * MONTHLY_PRICE_VND);

  // Cap theo tổng đã charge PRO_SUBSCRIPTION trong 90 ngày gần nhất.
  // Phòng case user gia hạn nhiều chu kỳ → chỉ refund tới mức đã trả thật.
  const lookbackCutoff = new Date(now.getTime() - 90 * 86400_000);
  const recentCharges = await db
    .select({ amount: userWalletTxn.amountVnd })
    .from(userWalletTxn)
    .where(
      and(
        eq(userWalletTxn.userId, userId),
        eq(userWalletTxn.type, 'PRO_SUBSCRIPTION'),
        gte(userWalletTxn.createdAt, lookbackCutoff),
      ),
    )
    .orderBy(desc(userWalletTxn.createdAt));
  const totalCharged = recentCharges.reduce(
    (acc, r) => acc + Math.abs(r.amount),
    0,
  );
  const refundVnd = Math.max(0, Math.min(rawRefund, totalCharged));

  // Refund (nếu > 0) + flip plan
  let refundTxnId: string | null = null;
  if (refundVnd > 0) {
    const { txnId } = await refundToWallet({
      userId,
      amountVnd: refundVnd,
      relatedType: 'library_pro',
      description: `Hoàn ${remainingDays.toFixed(1)} ngày PRO chưa dùng`,
    });
    refundTxnId = txnId;
  }

  await db
    .update(userTable)
    .set({ plan: 'FREE', proUntilAt: now, updatedAt: new Date() })
    .where(eq(userTable.id, userId));

  return NextResponse.json({
    ok: true,
    refunded: refundVnd,
    remainingDays: Number(remainingDays.toFixed(2)),
    refundTxnId,
  });
}
