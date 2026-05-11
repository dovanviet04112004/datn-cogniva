/**
 * GET /api/mastery/recommendations — gợi ý concept user nên học tiếp.
 *
 * Logic ở `lib/mastery/recommend.ts`. Endpoint chỉ wrap + auth.
 *
 * ?limit=10  (mặc định 10, max 50)
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { getRecommendations } from '@/lib/mastery/recommend';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 10), 50);

  const recommendations = await getRecommendations(session.user.id, limit);
  return NextResponse.json({ recommendations });
}
