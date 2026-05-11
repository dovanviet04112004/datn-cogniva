/**
 * /api/mastery — list mastery scores của user kèm concept name + domain.
 *
 * GET:
 *   ?limit=200&minAttempts=0
 *   Trả mảng { conceptId, conceptName, domain, score, attempts, correct, lastSeenAt }.
 *
 * Order: score ASC (yếu nhất trước) — để UI dễ thấy chỗ cần ôn.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq, gte } from 'drizzle-orm';

import { concept, db, mastery as masteryTable } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 500);
  const minAttempts = Math.max(
    0,
    Number(url.searchParams.get('minAttempts') ?? 0),
  );

  const rows = await db
    .select({
      conceptId: masteryTable.conceptId,
      conceptName: concept.name,
      domain: concept.domain,
      score: masteryTable.score,
      attempts: masteryTable.attempts,
      correct: masteryTable.correct,
      lastSeenAt: masteryTable.lastSeenAt,
    })
    .from(masteryTable)
    .innerJoin(concept, eq(concept.id, masteryTable.conceptId))
    .where(
      and(
        eq(masteryTable.userId, session.user.id),
        gte(masteryTable.attempts, minAttempts),
      ),
    )
    .orderBy(asc(masteryTable.score))
    .limit(limit);

  return NextResponse.json({ mastery: rows });
}
