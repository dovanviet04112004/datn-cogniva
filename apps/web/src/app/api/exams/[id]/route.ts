/**
 * GET    /api/exams/[id] — detail + questions (owner luôn thấy; student chỉ
 *                          khi PUBLISHED + maxScore > 0)
 * PUT    /api/exams/[id] — update metadata (owner only, status=DRAFT)
 * DELETE /api/exams/[id] — soft delete? KHÔNG — hard delete vì có FK cascade,
 *                          attempt user mất theo (chấp nhận trade-off Phase 16)
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, exam, examQuestion } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

const UPDATE_SCHEMA = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  durationSeconds: z.number().int().positive().nullable().optional(),
  passingScore: z.number().min(0).max(1).nullable().optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  allowReview: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  showResults: z.enum(['IMMEDIATE', 'AFTER_SUBMIT', 'AFTER_ALL_DONE']).optional(),
});

export async function GET(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [row] = await db.select().from(exam).where(eq(exam.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isOwner = row.ownerId === session.user.id;
  if (!isOwner && row.status === 'DRAFT') {
    // Student không xem được DRAFT
    return NextResponse.json({ error: 'Exam chưa publish' }, { status: 403 });
  }

  // Load questions theo orderIndex. Owner thấy đầy đủ (correctAnswer + rubric)
  // → để builder edit. Student chỉ thấy fields cần để làm bài
  // (KHÔNG bao gồm correctAnswer/explanation/acceptableAnswers).
  const questions = await db
    .select()
    .from(examQuestion)
    .where(eq(examQuestion.examId, id))
    .orderBy(asc(examQuestion.orderIndex));

  const stripped = isOwner
    ? questions
    : questions.map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        promptHtml: q.promptHtml,
        attachments: q.attachments,
        options: q.options,
        points: q.points,
        timeLimitSeconds: q.timeLimitSeconds,
        orderIndex: q.orderIndex,
      }));

  return NextResponse.json({
    exam: row,
    questions: stripped,
    isOwner,
  });
}

export async function PUT(request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [row] = await db.select().from(exam).where(eq(exam.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (row.status !== 'DRAFT') {
    return NextResponse.json(
      { error: 'Chỉ exam DRAFT mới edit được. Hiện status: ' + row.status },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = UPDATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(exam)
    .set(parsed.data)
    .where(eq(exam.id, id))
    .returning();

  return NextResponse.json({ exam: updated });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [row] = await db.select({ ownerId: exam.ownerId, status: exam.status }).from(exam).where(eq(exam.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db.delete(exam).where(eq(exam.id, id));
  return NextResponse.json({ ok: true });
}
