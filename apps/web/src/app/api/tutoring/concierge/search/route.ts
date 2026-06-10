/**
 * GET /api/tutoring/concierge/search — V4 T1 (2026-05-22).
 *
 * Hybrid search endpoint (FTS + vector RRF). Dùng cho:
 *   - UI direct search (smart bar trên hub khi user gõ "Tìm gia sư Toán")
 *   - Concierge agent tool call (internal)
 *
 * Query params:
 *   - q              : free text (optional)
 *   - subjectSlug    : filter
 *   - level          : filter
 *   - modality       : filter
 *   - budgetMaxVnd   : filter
 *   - limit          : default 10, max 30
 *
 * KHÔNG cache cho free text (mỗi user query khác); kết quả filter-only thì
 * có thể cache ở edge sau (V5).
 *
 * Spec: docs/plans/tutoring-v4.md §5.2.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { hybridSearchTutors } from '@/lib/tutoring/hybrid-search';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? undefined;
  const subjectSlug = url.searchParams.get('subjectSlug') ?? undefined;
  const level = url.searchParams.get('level') ?? undefined;
  const modality = url.searchParams.get('modality') ?? undefined;
  const budgetMaxStr = url.searchParams.get('budgetMaxVnd');
  const budgetMaxVnd = budgetMaxStr ? Number(budgetMaxStr) : undefined;
  const limitStr = url.searchParams.get('limit');
  const limit = limitStr ? Math.min(Math.max(Number(limitStr), 1), 30) : 10;

  const results = await hybridSearchTutors({
    query: q,
    filters: { subjectSlug, level, modality, budgetMaxVnd },
    limit,
  });

  return NextResponse.json({
    results: results.map((r) => ({
      id: r.id,
      userId: r.userId,
      headline: r.headline,
      hourlyRateVnd: r.hourlyRateVnd,
      modality: r.modality,
      avatarUrl: r.avatarUrl,
      ratingAvg: r.ratingAvg,
      ratingCount: r.ratingCount,
      sessionsCompleted: r.sessionsCompleted,
      verificationStatus: r.verificationStatus,
      score: r.score,
    })),
    count: results.length,
  });
}
