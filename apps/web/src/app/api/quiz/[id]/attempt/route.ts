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

import {
  db,
  question,
  quiz,
  quizAttempt,
  quizResponse,
  studySession,
  tutorSubject,
  tutorSubjectVerifyQuiz,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import {
  gradeMcq,
  gradeShort,
  gradeTrueFalse,
  type GradeResult,
} from '@/lib/quiz/grade';
import { applyAttempt } from '@/lib/mastery/update';
import { awardXp, XP_AMOUNTS } from '@/lib/gamification/xp';
import { recordQuizOutcome } from '@/lib/library/outcome-tracker';

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

  // Chấm song song — MCQ/TRUE_FALSE trả ngay (binary), SHORT mới cần
  // LLM call. Promise.all giảm latency tổng từ N×~10s xuống ~10s.
  type ResultItem = {
    questionId: string;
    type: 'MCQ' | 'TRUE_FALSE' | 'SHORT';
    score: number;
    feedback: string;
    correctAnswer: unknown;
    explanation: string;
    masteryAfter: number | null;
  };

  type Question = (typeof questions)[number];

  // ── Bước 1: CHẤM song song (SHORT cần LLM → parallel giảm latency). KHÔNG
  // đụng mastery ở đây để tránh race. ──
  const gradedPromises = parsed.data.answers.map(
    async (ans): Promise<{ q: Question; grade: GradeResult } | null> => {
      const q = qById.get(ans.questionId);
      if (!q) return null;
      let grade: GradeResult = { score: 0, feedback: 'Không tìm thấy câu hỏi.' };
      if (q.type === 'MCQ' && typeof ans.userAnswer === 'number') {
        grade = gradeMcq(ans.userAnswer, q.correctAnswer as number);
      } else if (q.type === 'TRUE_FALSE' && typeof ans.userAnswer === 'boolean') {
        grade = gradeTrueFalse(ans.userAnswer, q.correctAnswer as boolean);
      } else if (q.type === 'SHORT' && typeof ans.userAnswer === 'string') {
        grade = await gradeShort(q.prompt, q.correctAnswer as string, ans.userAnswer);
      } else {
        grade = { score: 0, feedback: 'Định dạng câu trả lời không hợp lệ.' };
      }
      return { q, grade };
    },
  );
  const graded = (await Promise.all(gradedPromises)).filter(
    (g): g is { q: Question; grade: GradeResult } => g !== null,
  );

  // ── Bước 2: cập nhật mastery TUẦN TỰ → tránh lost-update khi nhiều câu CÙNG
  // concept trong 1 lần làm (coverAll sinh 2 câu/chunk cho 1 atom → rất hay gặp).
  // Sequential đảm bảo applyAttempt sau đọc score đã commit của câu trước cùng atom. ──
  const results: ResultItem[] = [];
  for (const { q, grade } of graded) {
    let masteryAfter: number | null = null;
    if (q.conceptId) {
      masteryAfter = await applyAttempt(
        session.user.id,
        q.conceptId,
        grade.score,
        'quiz',
        quizRow.workspaceId,
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

  // Lưu LỊCH SỬ làm quiz (quiz_attempt + quiz_response) → quản trị biết câu nào
  // "đã làm" + xem lại điểm. isCorrect = score ≥ 0.5 (SHORT chấm 0..1). Dedup
  // theo questionId (unique index attemptId+questionId) phòng client gửi trùng.
  const now = new Date();
  const userAnswerById = new Map(
    parsed.data.answers.map((a) => [a.questionId, a.userAnswer]),
  );
  const [attempt] = await db
    .insert(quizAttempt)
    .values({
      quizId,
      userId: session.user.id,
      startedAt: now,
      submittedAt: now,
      score: totalScore,
      maxScore,
      percentage,
    })
    .returning({ id: quizAttempt.id });
  if (attempt && results.length > 0) {
    const seen = new Set<string>();
    const responseValues = results
      .filter((r) => {
        if (seen.has(r.questionId)) return false;
        seen.add(r.questionId);
        return true;
      })
      .map((r) => ({
        attemptId: attempt.id,
        questionId: r.questionId,
        userId: session.user.id,
        answer: userAnswerById.get(r.questionId) ?? null,
        isCorrect: r.score >= 0.5,
        answeredAt: now,
      }));
    if (responseValues.length > 0) {
      await db.insert(quizResponse).values(responseValues);
    }
  }

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

  // Gamification: cộng XP theo số câu đúng (score ≥ 0.5)
  const correctCount = results.filter((r) => r.score >= 0.5).length;
  const xpAmount = correctCount * XP_AMOUNTS.QUIZ_ANSWER_CORRECT;
  let newAchievements: string[] = [];
  if (xpAmount > 0) {
    const awarded = await awardXp(session.user.id, xpAmount, {
      source: 'quiz',
      totalCount: 1, // 1 quiz hoàn thành
    });
    newAchievements = awarded.newAchievements;
  }

  // Phase 21 V3 — nếu quiz này là tutor_subject_verify_quiz (link 1-1 qua
  // bảng tutor_subject_verify_quiz.quizId), auto cập nhật score + mark
  // PASSED nếu ≥ passThreshold. Tutor không cần PATCH thủ công nữa.
  let verifyResult: { passed: boolean; subjectId: string } | null = null;
  const [verifyLink] = await db
    .select({
      id: tutorSubjectVerifyQuiz.id,
      tutorSubjectId: tutorSubjectVerifyQuiz.tutorSubjectId,
      status: tutorSubjectVerifyQuiz.status,
      passThreshold: tutorSubjectVerifyQuiz.passThreshold,
    })
    .from(tutorSubjectVerifyQuiz)
    .where(eq(tutorSubjectVerifyQuiz.quizId, quizId))
    .limit(1);
  if (verifyLink && verifyLink.status === 'PENDING') {
    const passed = percentage >= verifyLink.passThreshold;
    await db.transaction(async (tx) => {
      await tx
        .update(tutorSubjectVerifyQuiz)
        .set({
          status: passed ? 'PASSED' : 'FAILED',
          score: percentage,
          completedAt: new Date(),
        })
        .where(eq(tutorSubjectVerifyQuiz.id, verifyLink.id));
      if (passed) {
        await tx
          .update(tutorSubject)
          .set({
            verifiedAt: new Date(),
            verifyScore: percentage,
          })
          .where(eq(tutorSubject.id, verifyLink.tutorSubjectId));
      }
    });
    verifyResult = { passed, subjectId: verifyLink.tutorSubjectId };
  }

  // Phase 2 Pillar #5: ghi outcome cho library docs đã import vào workspace
  // của quiz (nếu có). Best-effort — không kill response. Note `percentage`
  // ở đây là 0..100 → chia 100 trước khi pass.
  if (quizRow.workspaceId) {
    void recordQuizOutcome({
      userId: session.user.id,
      workspaceId: quizRow.workspaceId,
      percentage: percentage / 100,
      context: { score: totalScore, maxScore },
    }).catch(() => {
      /* silent — outcome best-effort */
    });
  }

  return NextResponse.json({
    results,
    summary: { totalScore, maxScore, percentage },
    xp: { awarded: xpAmount, newAchievements },
    verifyResult,
  });
}
