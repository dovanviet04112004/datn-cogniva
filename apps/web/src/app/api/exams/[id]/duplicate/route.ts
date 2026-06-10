/**
 * POST /api/exams/[id]/duplicate — clone exam thành DRAFT mới.
 *
 * Use case chính: owner đã publish exam, muốn tạo lại "y hệt" với mode khác
 * (vd: bản gốc TIMED → muốn chạy Live; hoặc clone để tách nhiều ca thi).
 *
 * Clone:
 *   - exam row: mọi field config trừ status (→ DRAFT), liveCode (→ null, sinh
 *     mới khi publish), publishedAt (→ null), maxScore giữ vì sẽ recompute.
 *   - examQuestion rows: clone tất cả, link sang exam mới qua examId mới.
 *
 * KHÔNG clone:
 *   - examAttempt / examResponse / examViolation (lịch sử thuộc về exam gốc)
 *   - tournament_match (chỉ relevant với exam đang chạy)
 *
 * Body (optional): { mode?: ExamMode, title?: string } để override khi clone.
 * Nếu mode = LIVE/TOURNAMENT → API tự sinh liveCode mới.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, exam, examQuestion } from '@cogniva/db';
import { auth } from '@/lib/auth';
import { onExamChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  title: z.string().min(1).max(200).optional(),
  mode: z.enum(['PRACTICE', 'TIMED']).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [src] = await db.select().from(exam).where(eq(exam.id, id)).limit(1);
  if (!src) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (src.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const newMode = parsed.data.mode ?? src.mode;
  const newTitle = parsed.data.title ?? `${src.title} (bản sao)`;
  // Clone DRAFT — liveCode sẽ sinh khi publish lại, KHÔNG clone code cũ.
  const liveCode = null;

  // 1. Insert exam clone (DRAFT)
  const [cloned] = await db
    .insert(exam)
    .values({
      ownerId: src.ownerId,
      title: newTitle,
      description: src.description,
      mode: newMode,
      status: 'DRAFT',
      durationSeconds: src.durationSeconds,
      startsAt: null,
      endsAt: null,
      passingScore: src.passingScore,
      maxScore: 0, // sẽ recompute khi publish
      showResults: src.showResults,
      shuffleQuestions: src.shuffleQuestions,
      shuffleOptions: src.shuffleOptions,
      allowReview: src.allowReview,
      maxAttempts: src.maxAttempts,
      liveCode,
      currentQuestionIndex: null,
      minQuestions: src.minQuestions,
      maxQuestions: src.maxQuestions,
      targetSE: src.targetSE,
      antiCheat: src.antiCheat,
      classroomId: src.classroomId,
      conceptIds: src.conceptIds,
    })
    .returning();

  if (!cloned) {
    return NextResponse.json({ error: 'Clone thất bại' }, { status: 500 });
  }

  // 2. Clone questions — load batch + insert batch (giữ orderIndex)
  const srcQuestions = await db
    .select()
    .from(examQuestion)
    .where(eq(examQuestion.examId, src.id));

  if (srcQuestions.length > 0) {
    await db.insert(examQuestion).values(
      srcQuestions.map((q) => ({
        examId: cloned.id,
        type: q.type,
        prompt: q.prompt,
        promptHtml: q.promptHtml,
        attachments: q.attachments,
        options: q.options,
        correctAnswer: q.correctAnswer,
        acceptableAnswers: q.acceptableAnswers,
        rubric: q.rubric,
        testCases: q.testCases,
        points: q.points,
        partialCredit: q.partialCredit,
        difficulty: q.difficulty,
        discrimination: q.discrimination,
        guessing: q.guessing,
        conceptId: q.conceptId,
        explanation: q.explanation,
        hint: q.hint,
        timeLimitSeconds: q.timeLimitSeconds,
        orderIndex: q.orderIndex,
      })),
    );
  }

  // Exam clone mới xuất hiện trong list owned → bust cache list.
  await onExamChanged(cloned.ownerId, cloned.workspaceId);
  return NextResponse.json({
    exam: cloned,
    clonedQuestionCount: srcQuestions.length,
  }, { status: 201 });
}
