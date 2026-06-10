/**
 * GET /api/analytics — aggregate usage + cost cho user hiện tại.
 *
 * Output:
 *   {
 *     totalMessages: N,
 *     totalPromptTokens: N,
 *     totalCompletionTokens: N,
 *     totalCostUsd: 0.xxx,
 *     last7Days: [{ date, messages, costUsd }],
 *     byModel: [{ model, messages, costUsd }]
 *   }
 *
 * Logic aggregate tách sang `lib/analytics/get-user-analytics.ts` để trang SSR
 * /analytics dùng chung (1 nguồn duy nhất). Route giữ contract cho mobile.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { getUserAnalytics } from '@/lib/analytics/get-user-analytics';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const data = await getUserAnalytics(session.user.id);
  return NextResponse.json(data);
}
