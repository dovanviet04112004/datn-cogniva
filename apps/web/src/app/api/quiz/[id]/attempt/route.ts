/**
 * POST /api/quiz/[id]/attempt — submit câu trả lời, chấm + update mastery.
 *
 * Body:
 *   {
 *     answers: Array<{
 *       questionId: string,
 *       userAnswer: number | boolean | string
 *     }>
 *   }
 *
 * Logic:
 *   1. Load questions của quiz, verify ownership.
 *   2. Với mỗi câu → chấm theo loại (MCQ/TRUE_FALSE binary, SHORT LLM).
 *   3. Với conceptId của câu → applyAttempt (cập nhật BKT mastery).
 *   4. Lưu vào study_session metadata (sessionType='QUIZ') để analytics.
 *   5. Trả về detail: score từng câu, feedback, explanation, mastery snapshot.
 *
 * Idempotency: NOT enforced — user có thể attempt lại quiz, mastery update lại.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db, question, quiz, studySession } from '@cogniva/db';

import { auth } from '@/lib/auth';
import {
  gradeMcq,
  gradeShort,
  gradeTrueFalse,
  type GradeResult,
} from '@/lib/quiz/grade';
import { applyAttempt } from '@/lib/mastery/update';

export const runtime = 'nodejs';
export const maxDuration = 60; // SHORT grading có LLM call

const ANSWER_SCHEMA = z.object({
  questionId: z.string(),
  /** Discriminated: MCQ=number, TRUE_FALSE=boolean, SHORT=string. */
  userAnswer: z.union([z.number(), z.boolean(), z.string()]),
});

const SCHEMA = z.object({
  answers: z.array(ANSWER_SCHEMA).min(1).max(50),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify quiz ownership
  const [quizRow] = await db
    .select()
    .from(quiz)
    .where(and(eq(quiz.id, quizId), eq(quiz.userId, session.user.id)))
    .limit(1);
  if (!quizRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Load questions cần chấm
  const questionIds = parsed.data.answers.map((a) => a.questionId);
  const questions = await db
    .select()
    .from(question)
    .where(and(eq(question.quizId, quizId), inArray(question.id, questionIds)));
  const qById = new Map(questions.map((q) => [q.id, q]));

  // Chấm tuần tự (LLM calls cho SHORT)
  type ResultItem = {
    questionId: string;
    type: 'MCQ' | 'TRUE_FALSE' | 'SHORT';
    score: number;
    feedback: string;
    correctAnswer: unknown;
    explanation: string;
    masteryAfter: number | null;
  };
  const results: ResultItem[] = [];

  for (const ans of parsed.data.answers) {
    const q = qById.get(ans.questionId);
    if (!q) continue;
    let grade: GradeResult = { score: 0, feedback: 'Không tìm thấy câu hỏi.' };

    if (q.type === 'MCQ' && typeof ans.userAnswer === 'number') {
      grade = gradeMcq(ans.userAnswer, q.correctAnswer as number);
    } else if (q.type === 'TRUE_FALSE' && typeof ans.userAnswer === 'boolean') {
      grade = gradeTrueFalse(ans.userAnswer, q.correctAnswer as boolean);
    } else if (q.type === 'SHORT' && typeof ans.userAnswer === 'string') {
      grade = await gradeShort(
        q.prompt,
        q.correctAnswer as string,
        ans.userAnswer,
      );
    } else {
      grade = { score: 0, feedback: 'Định dạng câu trả lời không hợp lệ.' };
    }

    let masteryAfter: number | null = null;
    if (q.conceptId) {
      masteryAfter = await applyAttempt(
        session.user.id,
        q.conceptId,
        grade.score,
      );
    }

    results.push({
      questionId: q.id,
      type: q.type as 'MCQ' | 'TRUE_FALSE' | 'SHORT',
      score: grade.score,
      feedback: grade.feedback,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      masteryAfter,
    });
  }

  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const maxScore = results.length;
  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  // Lưu session log
  await db.insert(studySession).values({
    userId: session.user.id,
    sessionType: 'QUIZ',
    startedAt: new Date(),
    endedAt: new Date(),
    metadata: {
      quizId,
      totalScore,
      maxScore,
      percentage,
      itemCount: results.length,
    },
  });

  return NextResponse.json({
    results,
    summary: { totalScore, maxScore, percentage },
  });
}
