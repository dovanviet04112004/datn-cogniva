/**
 * GET /api/account/usage — current AI usage cho user đang login.
 *
 * Trả về:
 *   {
 *     plan: 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE',
 *     spentUsd: number,        // đã dùng hôm nay
 *     quotaUsd: number,        // quota daily
 *     remainingUsd: number,
 *     resetAt: ISO string,     // 00:00 UTC kế tiếp
 *   }
 *
 * Dùng cho:
 *   - Settings page (UI hiển thị quota bar)
 *   - In-app notification khi quota gần hết
 *   - Pre-flight check trước khi user gửi prompt lớn
 *
 * Privacy: chỉ trả info của user gọi, không leak user khác.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { getUserDailyUsage, type Plan } from '@/lib/observability/cost-guardrail';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Better Auth additionalFields → user.plan
  const plan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;
  const usage = await getUserDailyUsage(session.user.id, plan);

  return NextResponse.json({
    plan,
    spentUsd: usage.spentUsd,
    quotaUsd: usage.quotaUsd,
    remainingUsd: usage.remainingUsd,
    resetAt: usage.resetAt,
    spentPct: Math.round((usage.spentUsd / usage.quotaUsd) * 100),
  });
}
