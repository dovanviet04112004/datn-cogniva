/**
 * POST /api/exams/[id]/questions — thêm câu hỏi manual.
 *
 * Owner only, exam phải ở status DRAFT (publish rồi thì không thêm được —
 * tránh thay đổi exam khi student đã làm bài).
 *
 * orderIndex auto-increment dựa max hiện có. UI có thể reorder qua PUT
 * /api/exams/[id]/questions/[qId] (Phase 16 chưa wire, dùng UI bulk reorder).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, exam, examQuestion } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

const QUESTION_SCHEMA = z.object({
  type: z.enum([
    'MCQ_SINGLE',
    'MCQ_MULTI',
    'TRUE_FALSE',
    'SHORT',
    'ESSAY',
    'FILL_BLANK',
    'MATCHING',
    'ORDERING',
    'CODE',
    'MATH',
    'DRAWING',
  ]),
  prompt: z.string().min(1).max(5000),
  promptHtml: z.string().max(20_000).optional(),
  attachments: z
    .array(
      z.object({
        type: z.string(),
        url: z.string().url(),
        alt: z.string().optional(),
      }),
    )
    .optional(),
  options: z.union([
    z.array(z.string()),
    z.record(z.string(), z.string()),
    z.null(),
  ]).optional(),
  correctAnswer: z.unknown().optional(),
  acceptableAnswers: z.array(z.string()).optional(),
  rubric: z.unknown().optional(),
  points: z.number().positive().max(1000).default(1),
  partialCredit: z.boolean().optional(),
  conceptId: z.string().optional(),
  explanation: z.string().max(5000).optional(),
  hint: z.string().max(1000).optional(),
  timeLimitSeconds: z.number().int().positive().max(3600).optional(),
});

export async function POST(request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [parent] = await db
    .select({ ownerId: exam.ownerId, status: exam.status })
    .from(exam)
    .where(eq(exam.id, id))
    .limit(1);
  if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (parent.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (parent.status !== 'DRAFT') {
    return NextResponse.json(
      { error: `Chỉ DRAFT exam mới thêm câu hỏi. Hiện: ${parent.status}` },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = QUESTION_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Get next orderIndex
  const [maxOrder] = await db
    .select({ max: sql<number>`coalesce(max(${examQuestion.orderIndex}), -1)::int` })
    .from(examQuestion)
    .where(eq(examQuestion.examId, id));
  const nextIndex = (maxOrder?.max ?? -1) + 1;

  const [created] = await db
    .insert(examQuestion)
    .values({
      examId: id,
      type: parsed.data.type,
      prompt: parsed.data.prompt,
      promptHtml: parsed.data.promptHtml ?? null,
      attachments: parsed.data.attachments ?? null,
      options: (parsed.data.options ?? null) as never,
      correctAnswer: parsed.data.correctAnswer ?? null,
      acceptableAnswers: parsed.data.acceptableAnswers ?? null,
      rubric: parsed.data.rubric ?? null,
      points: parsed.data.points,
      partialCredit: parsed.data.partialCredit ?? false,
      conceptId: parsed.data.conceptId ?? null,
      explanation: parsed.data.explanation ?? null,
      hint: parsed.data.hint ?? null,
      timeLimitSeconds: parsed.data.timeLimitSeconds ?? null,
      orderIndex: nextIndex,
    })
    .returning();

  return NextResponse.json({ question: created }, { status: 201 });
}
