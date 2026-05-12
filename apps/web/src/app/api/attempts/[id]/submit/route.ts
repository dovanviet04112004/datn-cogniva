/**
 * POST /api/attempts/[id]/submit — finalize attempt + grade tất cả responses.
 *
 * Flow:
 *   1. Check attempt IN_PROGRESS + user là student của attempt
 *   2. Load tất cả responses + questions liên quan
 *   3. Với mỗi response chưa grade hoặc cần re-grade:
 *      - Auto-grade (gradeResponse) cho 7 type auto
 *      - AI grade cho SHORT/ESSAY khi cần
 *   4. Update responses + sum totalScore
 *   5. Update attempt: status='SUBMITTED', score, percentage, passed, timeSpent
 *
 * Idempotent: gọi lại sẽ no-op (status đã !=IN_PROGRESS → return result hiện tại).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';

import {
  db,
  exam,
  examAttempt,
  examQuestion,
  examResponse,
} from '@cogniva/db';
import { auth } from '@/lib/auth';
import { gradeResponse } from '@/lib/exam/grade';
import { aiGradeShortAnswer, aiGradeEssay } from '@/lib/ai/grade-essay';
import type { Plan } from '@/lib/observability/cost-guardrail';
import { logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [attempt] = await db.select().from(examAttempt).where(eq(examAttempt.id, id)).limit(1);
  if (!attempt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (attempt.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Idempotent — đã submit thì return current state
  if (attempt.status !== 'IN_PROGRESS') {
    return NextResponse.json({
      attempt,
      alreadySubmitted: true,
    });
  }

  // Load context
  const [parent] = await db.select().from(exam).where(eq(exam.id, attempt.examId)).limit(1);
  if (!parent) return NextResponse.json({ error: 'Exam not found' }, { status: 404 });

  const questions = await db
    .select()
    .from(examQuestion)
    .where(eq(examQuestion.examId, attempt.examId));
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  const responses = await db
    .select()
    .from(examResponse)
    .where(eq(examResponse.attemptId, id));

  // Grade từng response. Auto-grade trước (sync, fast); AI-grade song song.
  const plan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;
  let totalScore = 0;
  let questionsAnswered = 0;
  const updates: Array<{ id: string; isCorrect: boolean; pointsEarned: number; aiGrading: unknown; needsReview: boolean }> = [];
  const aiQueue: Array<{
    responseId: string;
    type: 'short' | 'essay';
    question: typeof questions[number];
    answer: string;
  }> = [];

  for (const r of responses) {
    const q = questionMap.get(r.questionId);
    if (!q) continue;
    questionsAnswered++;

    const result = gradeResponse(q, r.answer);

    if (result.needsAiGrading && typeof r.answer === 'string' && r.answer.trim()) {
      // Defer AI grade
      const kind = q.type === 'ESSAY' ? 'essay' : 'short';
      aiQueue.push({ responseId: r.id, type: kind, question: q, answer: r.answer });
      // Tạm thời 0 điểm, will override sau AI grade
      updates.push({
        id: r.id,
        isCorrect: false,
        pointsEarned: 0,
        aiGrading: null,
        needsReview: true,
      });
    } else {
      totalScore += result.pointsEarned;
      updates.push({
        id: r.id,
        isCorrect: result.isCorrect,
        pointsEarned: result.pointsEarned,
        aiGrading: null,
        needsReview: !!result.needsAiGrading,
      });
    }
  }

  // Run AI grading parallel (capacity ~ 5 concurrent). Sai 1 không kill cả batch.
  if (aiQueue.length > 0) {
    logger.info('exam.submit.ai-grade-start', {
      attempt_id: id,
      count: aiQueue.length,
    });
    const concurrency = 5;
    for (let i = 0; i < aiQueue.length; i += concurrency) {
      const batch = aiQueue.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (item) => {
          try {
            const ctx2 = { userId: session.user.id, plan };
            const ai =
              item.type === 'essay'
                ? await aiGradeEssay(item.question, item.answer, ctx2)
                : await aiGradeShortAnswer(item.question, item.answer, ctx2);
            return { ...item, ai };
          } catch (err) {
            logger.error('exam.submit.ai-grade-fail', {
              response_id: item.responseId,
              error: err instanceof Error ? err.message : String(err),
            });
            return { ...item, ai: null };
          }
        }),
      );
      for (const r of results) {
        const u = updates.find((x) => x.id === r.responseId);
        if (!u) continue;
        if (r.ai) {
          u.isCorrect = r.ai.isCorrect;
          u.pointsEarned = r.ai.score;
          u.aiGrading = r.ai;
          u.needsReview = r.ai.flaggedForReview ?? false;
          totalScore += r.ai.score;
        } else {
          u.needsReview = true; // flag để teacher manual grade
        }
      }
    }
  }

  // Bulk update responses
  if (updates.length > 0) {
    await Promise.all(
      updates.map((u) =>
        db
          .update(examResponse)
          .set({
            isCorrect: u.isCorrect,
            pointsEarned: u.pointsEarned,
            aiGrading: u.aiGrading as never,
            needsReview: u.needsReview,
          })
          .where(eq(examResponse.id, u.id)),
      ),
    );
  }

  // Finalize attempt
  const maxScore = parent.maxScore || questions.reduce((s, q) => s + q.points, 0);
  const percentage = maxScore > 0 ? totalScore / maxScore : 0;
  const passed =
    parent.passingScore != null ? percentage >= parent.passingScore : null;
  const now = new Date();
  const timeSpentSec = Math.round((now.getTime() - attempt.startedAt.getTime()) / 1000);

  const [updatedAttempt] = await db
    .update(examAttempt)
    .set({
      status: 'SUBMITTED',
      submittedAt: now,
      score: totalScore,
      maxScore,
      percentage,
      passed,
      timeSpentSeconds: timeSpentSec,
      questionsAnswered,
    })
    .where(eq(examAttempt.id, id))
    .returning();

  return NextResponse.json({
    attempt: updatedAttempt,
    totalResponses: responses.length,
    aiGraded: aiQueue.length,
  });
}
