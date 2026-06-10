/**
 * GET /api/exams/[id]/proctor — owner list mọi attempt + cheatRiskScore.
 *
 * Trả về row { id, userId, userName, status, startedAt, submittedAt, score,
 *              cheatRiskScore, flagged, flagReason, violationCount }.
 *
 * Sort: flagged trước, sau đó cheatRiskScore desc.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, sql, desc } from 'drizzle-orm';

import { db, exam, examAttempt, examViolation, user } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [parent] = await db.select().from(exam).where(eq(exam.id, id)).limit(1);
  if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (parent.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Join examAttempt + user + count violations
  const rows = await db
    .select({
      id: examAttempt.id,
      userId: examAttempt.userId,
      userName: user.name,
      status: examAttempt.status,
      startedAt: examAttempt.startedAt,
      submittedAt: examAttempt.submittedAt,
      score: examAttempt.score,
      cheatRiskScore: examAttempt.cheatRiskScore,
      flagged: examAttempt.flagged,
      flagReason: examAttempt.flagReason,
      violationCount: sql<number>`(SELECT COUNT(*)::int FROM ${examViolation} WHERE ${examViolation.attemptId} = ${examAttempt.id})`,
    })
    .from(examAttempt)
    .innerJoin(user, eq(examAttempt.userId, user.id))
    .where(eq(examAttempt.examId, id))
    .orderBy(desc(examAttempt.flagged), desc(examAttempt.cheatRiskScore));

  return NextResponse.json({ attempts: rows });
}
