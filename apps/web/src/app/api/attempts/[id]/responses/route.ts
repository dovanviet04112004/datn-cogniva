/**
 * POST /api/attempts/[id]/responses — auto-save 1 response cho 1 question.
 *
 * Idempotent: upsert theo (attemptId, questionId) UNIQUE index. Client gọi mỗi
 * khi user thay đổi đáp án → state mới persist. KHÔNG grade ngay (chỉ lưu);
 * grade chạy ở endpoint /submit cuối.
 *
 * Tại sao defer grading:
 *   - Practice mode IMMEDIATE feedback: cần grade ngay → client gọi ?grade=1
 *   - Timed mode: grade ngay tốn LLM token nếu SHORT cần AI; defer cuối tránh
 *     spam khi student đổi đáp án nhiều lần
 *   - Live mode Phase 17: grade async khi teacher next câu
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  exam,
  examAttempt,
  examQuestion,
  examResponse,
} from '@cogniva/db';
import { auth } from '@/lib/auth';
import { gradeResponse } from '@/lib/exam/grade';
import { aiGradeShortAnswer } from '@/lib/ai/grade-essay';
import type { Plan } from '@/lib/observability/cost-guardrail';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

const SCHEMA = z.object({
  questionId: z.string(),
  answer: z.unknown(),
  responseTimeMs: z.number().int().min(0).optional(),
});

export async function POST(request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [attempt] = await db.select().from(examAttempt).where(eq(examAttempt.id, id)).limit(1);
  if (!attempt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (attempt.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (attempt.status !== 'IN_PROGRESS') {
    return NextResponse.json(
      { error: `Attempt đã ${attempt.status}, không lưu thêm response` },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { questionId, answer, responseTimeMs } = parsed.data;

  // Check questionId thuộc exam của attempt này (anti-forgery)
  const [q] = await db
    .select()
    .from(examQuestion)
    .where(
      and(eq(examQuestion.id, questionId), eq(examQuestion.examId, attempt.examId)),
    )
    .limit(1);
  if (!q) {
    return NextResponse.json({ error: 'Question không thuộc exam này' }, { status: 400 });
  }

  // Practice mode: grade ngay (immediate feedback). Timed/Live: defer.
  const url = new URL(request.url);
  const wantGrade = url.searchParams.get('grade') === '1';
  const [parent] = await db
    .select({ mode: exam.mode })
    .from(exam)
    .where(eq(exam.id, attempt.examId))
    .limit(1);

  let isCorrect: boolean | null = null;
  let pointsEarned = 0;
  let aiGrading: unknown = null;
  let needsReview = false;

  // PRACTICE với ?grade=1 → grade ngay để hiện feedback. TIMED defer grade
  // cho /submit cuối (tránh AI token spam khi student edit answer nhiều lần).
  const shouldGrade = wantGrade && parent?.mode === 'PRACTICE';
  if (shouldGrade) {
    const result = gradeResponse(q, answer);
    isCorrect = result.isCorrect;
    pointsEarned = result.pointsEarned;

    // AI fallback cho SHORT khi exact match fail
    if (result.needsAiGrading && q.type === 'SHORT' && typeof answer === 'string') {
      const ai = await aiGradeShortAnswer(q, answer, {
        userId: session.user.id,
        plan: ((session.user as { plan?: string }).plan ?? 'FREE') as Plan,
      });
      pointsEarned = ai.score;
      isCorrect = ai.isCorrect;
      aiGrading = ai;
      needsReview = ai.flaggedForReview ?? false;
    } else if (result.needsAiGrading) {
      needsReview = true;
    }
  }

  // Upsert response (1 row/question/attempt)
  const now = new Date();
  await db
    .insert(examResponse)
    .values({
      attemptId: id,
      questionId,
      answer: answer as never,
      isCorrect,
      pointsEarned,
      startedAt: now,
      submittedAt: now,
      responseTimeMs: responseTimeMs ?? null,
      aiGrading,
      needsReview,
    })
    .onConflictDoUpdate({
      target: [examResponse.attemptId, examResponse.questionId],
      set: {
        answer: answer as never,
        isCorrect,
        pointsEarned,
        submittedAt: now,
        responseTimeMs: responseTimeMs ?? null,
        aiGrading,
        needsReview,
      },
    });

  return NextResponse.json({
    ok: true,
    graded: shouldGrade,
    isCorrect,
    pointsEarned,
  });
}
