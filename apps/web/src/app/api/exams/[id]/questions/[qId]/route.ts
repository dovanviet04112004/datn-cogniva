/**
 * PUT    /api/exams/[id]/questions/[qId] — update (owner, DRAFT)
 * DELETE /api/exams/[id]/questions/[qId] — remove + reorder remaining
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, exam, examQuestion } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string; qId: string }> };

const UPDATE_SCHEMA = z.object({
  prompt: z.string().min(1).max(5000).optional(),
  promptHtml: z.string().max(20_000).nullable().optional(),
  options: z.unknown().optional(),
  correctAnswer: z.unknown().optional(),
  acceptableAnswers: z.array(z.string()).nullable().optional(),
  rubric: z.unknown().optional(),
  points: z.number().positive().max(1000).optional(),
  partialCredit: z.boolean().optional(),
  explanation: z.string().max(5000).nullable().optional(),
  hint: z.string().max(1000).nullable().optional(),
  timeLimitSeconds: z.number().int().positive().max(3600).nullable().optional(),
  orderIndex: z.number().int().min(0).optional(),
});

async function checkOwnerDraft(examId: string, userId: string) {
  const [parent] = await db
    .select({ ownerId: exam.ownerId, status: exam.status })
    .from(exam)
    .where(eq(exam.id, examId))
    .limit(1);
  if (!parent) return { ok: false, status: 404, error: 'Exam not found' };
  if (parent.ownerId !== userId) return { ok: false, status: 403, error: 'Forbidden' };
  if (parent.status !== 'DRAFT')
    return { ok: false, status: 409, error: `Chỉ DRAFT mới edit được. Hiện: ${parent.status}` };
  return { ok: true as const };
}

export async function PUT(request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, qId } = await ctx.params;

  const guard = await checkOwnerDraft(id, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await request.json().catch(() => null);
  const parsed = UPDATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(examQuestion)
    .set(parsed.data as never)
    .where(and(eq(examQuestion.id, qId), eq(examQuestion.examId, id)))
    .returning();

  if (!updated) return NextResponse.json({ error: 'Question not found' }, { status: 404 });
  return NextResponse.json({ question: updated });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, qId } = await ctx.params;

  const guard = await checkOwnerDraft(id, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const [removed] = await db
    .delete(examQuestion)
    .where(and(eq(examQuestion.id, qId), eq(examQuestion.examId, id)))
    .returning({ orderIndex: examQuestion.orderIndex });

  if (!removed) return NextResponse.json({ error: 'Question not found' }, { status: 404 });

  // Shift orderIndex của những câu sau xuống 1 để liền lạc
  await db
    .update(examQuestion)
    .set({ orderIndex: sql`${examQuestion.orderIndex} - 1` })
    .where(
      and(eq(examQuestion.examId, id), gt(examQuestion.orderIndex, removed.orderIndex)),
    );

  return NextResponse.json({ ok: true });
}
