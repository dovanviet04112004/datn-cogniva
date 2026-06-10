/**
 * QuizAttemptService — submit câu trả lời, chấm + update mastery. Port từ
 * apps/web/src/app/api/quiz/[id]/attempt/route.ts — GIỮ NGUYÊN wire shape.
 *
 * Flow:
 *   1. Verify quiz ownership → load questions cần chấm.
 *   2. Chấm SONG SONG (SHORT cần LLM → parallel giảm latency N×~10s → ~10s).
 *   3. Mastery (BKT) update TUẦN TỰ — tránh lost-update khi nhiều câu CÙNG
 *      concept trong 1 lần làm (coverAll sinh 2 câu/chunk cho 1 atom).
 *      Route cũ KHÔNG dùng advisory lock — giữ nguyên semantics.
 *   4. Lưu lịch sử quiz_attempt + quiz_response (dedup theo questionId).
 *   5. study_session log + XP + tutor verify quiz + library outcome.
 *
 * Idempotency: NOT enforced — user attempt lại, mastery update lại (như cũ).
 */
import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type question as QuestionRow } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service';
import { MasteryUpdateService } from '../learning/mastery-update.service';
import { XP_AMOUNTS, XpService } from '../gamification/xp.service';
import { OutcomeTrackerService } from '../library/outcome-tracker.service';
import { QuizGradeService, type GradeResult } from './quiz-grade.service';
import type { AttemptQuizInput } from './dto/quiz.dto';

/** 1 item kết quả chấm — shape + thứ tự field như route cũ. */
type ResultItem = {
  questionId: string;
  type: 'MCQ' | 'TRUE_FALSE' | 'SHORT';
  score: number;
  feedback: string;
  correctAnswer: unknown;
  explanation: string;
  masteryAfter: number | null;
};

@Injectable()
export class QuizAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grader: QuizGradeService,
    private readonly masteryUpdate: MasteryUpdateService,
    private readonly xp: XpService,
    private readonly outcome: OutcomeTrackerService,
  ) {}

  async submitAttempt(userId: string, quizId: string, input: AttemptQuizInput) {
    // Verify quiz ownership
    const quizRow = await this.prisma.quiz.findFirst({ where: { id: quizId, user_id: userId } });
    if (!quizRow) throw new NotFoundException({ error: 'Not found' });

    // Load questions cần chấm
    const questionIds = input.answers.map((a) => a.questionId);
    const questions = await this.prisma.question.findMany({
      where: { quiz_id: quizId, id: { in: questionIds } },
    });
    const qById = new Map(questions.map((q) => [q.id, q]));

    // ── Bước 1: CHẤM song song. KHÔNG đụng mastery ở đây để tránh race. ──
    const gradedPromises = input.answers.map(
      async (ans): Promise<{ q: QuestionRow; grade: GradeResult } | null> => {
        const q = qById.get(ans.questionId);
        if (!q) return null;
        let grade: GradeResult = { score: 0, feedback: 'Không tìm thấy câu hỏi.' };
        if (q.type === 'MCQ' && typeof ans.userAnswer === 'number') {
          grade = this.grader.gradeMcq(ans.userAnswer, q.correct_answer as number);
        } else if (q.type === 'TRUE_FALSE' && typeof ans.userAnswer === 'boolean') {
          grade = this.grader.gradeTrueFalse(ans.userAnswer, q.correct_answer as boolean);
        } else if (q.type === 'SHORT' && typeof ans.userAnswer === 'string') {
          grade = await this.grader.gradeShort(q.prompt, q.correct_answer as string, ans.userAnswer);
        } else {
          grade = { score: 0, feedback: 'Định dạng câu trả lời không hợp lệ.' };
        }
        return { q, grade };
      },
    );
    const graded = (await Promise.all(gradedPromises)).filter(
      (g): g is { q: QuestionRow; grade: GradeResult } => g !== null,
    );

    // ── Bước 2: mastery TUẦN TỰ — applyAttempt sau đọc score đã commit của
    // câu trước cùng atom (BKT choke point, xem MasteryUpdateService). ──
    const results: ResultItem[] = [];
    for (const { q, grade } of graded) {
      let masteryAfter: number | null = null;
      if (q.concept_id) {
        masteryAfter = await this.masteryUpdate.applyAttempt(
          userId,
          q.concept_id,
          grade.score,
          'quiz',
          quizRow.workspace_id,
        );
      }
      results.push({
        questionId: q.id,
        type: q.type as 'MCQ' | 'TRUE_FALSE' | 'SHORT',
        score: grade.score,
        feedback: grade.feedback,
        correctAnswer: q.correct_answer,
        explanation: q.explanation,
        masteryAfter,
      });
    }

    const totalScore = results.reduce((sum, r) => sum + r.score, 0);
    const maxScore = results.length;
    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

    // Lưu LỊCH SỬ làm quiz (quiz_attempt + quiz_response) → quản trị biết câu
    // nào "đã làm" + xem lại điểm. isCorrect = score ≥ 0.5 (SHORT chấm 0..1).
    // Dedup theo questionId (unique index attemptId+questionId) phòng client gửi trùng.
    const now = new Date();
    const userAnswerById = new Map(input.answers.map((a) => [a.questionId, a.userAnswer]));
    const attempt = await this.prisma.quiz_attempt.create({
      data: {
        id: randomUUID(),
        quiz_id: quizId,
        user_id: userId,
        started_at: now,
        submitted_at: now,
        score: totalScore,
        max_score: maxScore,
        percentage,
      },
      select: { id: true },
    });
    if (results.length > 0) {
      const seen = new Set<string>();
      const responseValues = results
        .filter((r) => {
          if (seen.has(r.questionId)) return false;
          seen.add(r.questionId);
          return true;
        })
        .map((r) => {
          const answer = userAnswerById.get(r.questionId);
          return {
            id: randomUUID(),
            attempt_id: attempt.id,
            question_id: r.questionId,
            user_id: userId,
            // answer JSON NULL khi thiếu (Drizzle cũ ?? null) → DbNull.
            answer: answer === undefined ? Prisma.DbNull : (answer as Prisma.InputJsonValue),
            is_correct: r.score >= 0.5,
            answered_at: now,
          };
        });
      if (responseValues.length > 0) {
        await this.prisma.quiz_response.createMany({ data: responseValues });
      }
    }

    // Lưu session log
    await this.prisma.study_session.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        session_type: 'QUIZ',
        started_at: new Date(),
        ended_at: new Date(),
        metadata: { quizId, totalScore, maxScore, percentage, itemCount: results.length },
      },
    });

    // Gamification: cộng XP theo số câu đúng (score ≥ 0.5)
    const correctCount = results.filter((r) => r.score >= 0.5).length;
    const xpAmount = correctCount * XP_AMOUNTS.QUIZ_ANSWER_CORRECT;
    let newAchievements: string[] = [];
    if (xpAmount > 0) {
      const awarded = await this.xp.awardXp(userId, xpAmount, {
        source: 'quiz',
        totalCount: 1, // 1 quiz hoàn thành
      });
      newAchievements = awarded.newAchievements;
    }

    // Phase 21 V3 — nếu quiz này là tutor_subject_verify_quiz (link 1-1 qua
    // quizId), auto cập nhật score + mark PASSED nếu ≥ passThreshold.
    let verifyResult: { passed: boolean; subjectId: string } | null = null;
    const verifyLink = await this.prisma.tutor_subject_verify_quiz.findFirst({
      where: { quiz_id: quizId },
      select: { id: true, tutor_subject_id: true, status: true, pass_threshold: true },
    });
    if (verifyLink && verifyLink.status === 'PENDING') {
      const passed = percentage >= verifyLink.pass_threshold;
      await this.prisma.$transaction(async (tx) => {
        await tx.tutor_subject_verify_quiz.update({
          where: { id: verifyLink.id },
          data: {
            status: passed ? 'PASSED' : 'FAILED',
            score: percentage,
            completed_at: new Date(),
          },
        });
        if (passed) {
          await tx.tutor_subject.update({
            where: { id: verifyLink.tutor_subject_id },
            data: { verified_at: new Date(), verify_score: percentage },
          });
        }
      });
      verifyResult = { passed, subjectId: verifyLink.tutor_subject_id };
    }

    // Phase 2 Pillar #5: ghi outcome cho library docs đã import vào workspace
    // của quiz (nếu có). Best-effort — không kill response. `percentage` là
    // 0..100 → chia 100 trước khi pass.
    if (quizRow.workspace_id) {
      void this.outcome
        .recordQuizOutcome({
          userId,
          workspaceId: quizRow.workspace_id,
          percentage: percentage / 100,
          context: { score: totalScore, maxScore },
        })
        .catch(() => {
          /* silent — outcome best-effort */
        });
    }

    return {
      results,
      summary: { totalScore, maxScore, percentage },
      xp: { awarded: xpAmount, newAchievements },
      verifyResult,
    };
  }
}
