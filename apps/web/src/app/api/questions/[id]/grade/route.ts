/**
 * POST /api/questions/[id]/grade — grade 1 question + update mastery.
 *
 * Phase V5.2: dùng cho QuickQuiz recipe trong workspace notebook (chấm từng câu
 * rời, cross-quiz). Update mastery qua applyAttempt + ghi MARKER "đã làm" vào
 * quiz_response (attemptId=null) để trang quản trị biết câu này đã được làm.
 * Giữ 1 marker / (user, câu) — cập nhật đáp án/đúng-sai lần gần nhất.
 *
 * Body: { answer: number | string }
 * Returns: { correct: boolean, correctAnswer: unknown, explanation: string }
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db, question, quizResponse } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { applyAttempt } from '@/lib/mastery/update';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  answer: z.union([z.number(), z.string()]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [q] = await db
    .select()
    .from(question)
    .where(eq(question.id, id))
    .limit(1);
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Compare answer với correctAnswer. Schema jsonb có thể là number (MCQ
  // index) hoặc string (free text). So sánh strict equal sau khi normalize
  // số.
  const correctAnswer = q.correctAnswer;
  const userAnswer = parsed.data.answer;
  let correct = false;
  if (typeof correctAnswer === 'number' && typeof userAnswer === 'number') {
    correct = correctAnswer === userAnswer;
  } else if (typeof correctAnswer === 'string' && typeof userAnswer === 'string') {
    correct = correctAnswer.trim().toLowerCase() === userAnswer.trim().toLowerCase();
  }

  // Update mastery — best-effort
  if (q.conceptId) {
    try {
      await applyAttempt(
        session.user.id,
        q.conceptId,
        correct ? 1 : 0,
        'quiz',
      );
    } catch (err) {
      console.warn('[grade] applyAttempt fail:', err);
    }
  }

  // Marker "đã làm" cho trang quản trị — best-effort. UPSERT 1 marker null-attempt
  // / (user, câu) qua partial unique index `quiz_response_user_question_quick_idx`
  // → race-safe (2 lần chấm đồng thời không tạo row trùng): có rồi → update.
  try {
    await db
      .insert(quizResponse)
      .values({
        attemptId: null,
        questionId: id,
        userId: session.user.id,
        answer: userAnswer,
        isCorrect: correct,
        answeredAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [quizResponse.userId, quizResponse.questionId],
        targetWhere: isNull(quizResponse.attemptId),
        set: { answer: userAnswer, isCorrect: correct, answeredAt: new Date() },
      });
  } catch (err) {
    console.warn('[grade] quizResponse marker fail:', err);
  }

  return NextResponse.json({
    correct,
    correctAnswer,
    explanation: q.explanation,
  });
}
