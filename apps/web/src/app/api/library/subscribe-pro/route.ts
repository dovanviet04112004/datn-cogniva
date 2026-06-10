/**
 * POST /api/library/subscribe-pro — Phase 4 Step 5 (2026-05-27).
 *
 * Charge 199_000 VND/month → user.plan='PRO' + extend proUntilAt.
 *
 * Quy tắc extend:
 *   - Nếu proUntilAt > NOW() → cộng 30 ngày từ proUntilAt hiện tại (stack
 *     monthly đang còn hạn).
 *   - Nếu hết hạn hoặc NULL → reset = NOW() + 30 ngày.
 *
 * Plan='PRO' set ngay. Cron daily `library-pro-downgrade` sẽ revert FREE khi
 * proUntilAt < NOW() — không phải tự revert ở đây.
 *
 * Refund: KHÔNG — subscription đã consume một phần. V2 sẽ thêm pro-rated.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, user as userTable } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { chargeWallet, InsufficientBalanceError } from '@/lib/tutoring/wallet';

export const runtime = 'nodejs';

const MONTHLY_PRICE_VND = 199_000;
const MONTH_DAYS = 30;

const BODY = z.object({
  months: z.number().int().min(1).max(12).default(1),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const raw = await request.json().catch(() => ({}));
  const parsed = BODY.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const months = parsed.data.months;
  const totalPrice = MONTHLY_PRICE_VND * months;

  let txnId: string;
  try {
    const result = await chargeWallet({
      userId,
      amountVnd: totalPrice,
      type: 'PRO_SUBSCRIPTION',
      relatedType: 'library_pro',
      description: `Subscribe Cogniva PRO ${months} tháng`,
    });
    txnId = result.txnId;
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json(
        {
          error: 'Số dư ví không đủ',
          required: err.required,
          available: err.available,
        },
        { status: 402 },
      );
    }
    throw err;
  }

  // Compute new proUntilAt — extend hoặc reset
  const [row] = await db
    .select({ proUntilAt: userTable.proUntilAt })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const now = new Date();
  const cur = row?.proUntilAt ?? null;
  const base = cur && cur > now ? cur : now;
  const newProUntil = new Date(base.getTime() + months * MONTH_DAYS * 86400_000);

  await db
    .update(userTable)
    .set({ plan: 'PRO', proUntilAt: newProUntil, updatedAt: new Date() })
    .where(eq(userTable.id, userId));

  return NextResponse.json({
    ok: true,
    paid: totalPrice,
    months,
    proUntilAt: newProUntil.toISOString(),
    walletTxnId: txnId,
  });
}
