/**
 * GET /api/flashcards/stats — số liệu tổng quan cho dashboard.
 *
 * Trả:
 *   - byState: { NEW, LEARNING, REVIEW, RELEARNING }
 *   - dueToday: số cards due trong 24h tới
 *   - reviewsLast7d: số review log 7 ngày qua (để vẽ chart)
 *   - retentionRate: % review rating ≥ 3 (Good/Easy) trên tổng review
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { db, sql } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;

  // Count theo state
  const stateRows = await db.execute<{ state: string; n: number }>(sql`
    SELECT state, count(*)::int AS n
    FROM flashcard
    WHERE user_id = ${userId}
    GROUP BY state;
  `);
  const byState: Record<string, number> = { NEW: 0, LEARNING: 0, REVIEW: 0, RELEARNING: 0 };
  stateRows.forEach((r) => {
    byState[r.state] = r.n;
  });

  // Due trong 24h tới
  const [dueRow] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM flashcard
    WHERE user_id = ${userId} AND due <= NOW() + INTERVAL '1 day';
  `);

  // Review 7 ngày qua + retention rate (rating >= 3)
  const [reviewStat] = await db.execute<{ total: number; good: number }>(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE rating >= 3)::int AS good
    FROM review r
    INNER JOIN flashcard f ON f.id = r.flashcard_id
    WHERE f.user_id = ${userId}
      AND r.created_at >= NOW() - INTERVAL '7 days';
  `);

  const totalReviews = reviewStat?.total ?? 0;
  const retentionRate = totalReviews > 0 ? (reviewStat?.good ?? 0) / totalReviews : 0;

  return NextResponse.json({
    byState,
    dueToday: dueRow?.n ?? 0,
    reviewsLast7d: totalReviews,
    retentionRate,
  });
}
