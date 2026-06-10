/**
 * POST /api/attempts/[id]/disqualify — owner mark attempt DISQUALIFIED.
 *
 * Sau khi review violation timeline, owner quyết định reject attempt. Action
 * không reversible (status → DISQUALIFIED + score = 0).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db, exam, examAttempt } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [attempt] = await db.select().from(examAttempt).where(eq(examAttempt.id, id)).limit(1);
  if (!attempt) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Verify owner
  const [parent] = await db.select({ ownerId: exam.ownerId }).from(exam).where(eq(exam.id, attempt.examId)).limit(1);
  if (!parent || parent.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db
    .update(examAttempt)
    .set({
      status: 'DISQUALIFIED',
      flagged: true,
      flagReason: attempt.flagReason ?? 'Disqualified by owner',
      score: 0,
      percentage: 0,
      passed: false,
    })
    .where(eq(examAttempt.id, id));

  return NextResponse.json({ ok: true });
}
