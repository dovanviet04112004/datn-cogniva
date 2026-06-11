import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type question as QuestionRow } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service';
import { MasteryUpdateService } from '../learning/mastery-update.service';
import { XP_AMOUNTS, XpService } from '../gamification/xp.service';
import { OutcomeTrackerService } from '../library/outcome-tracker.service';
import { QuizGradeService, type GradeResult } from './quiz-grade.service';
import type { AttemptQuizInput } from './dto/quiz.dto';

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
    const quizRow = await this.prisma.quiz.findFirst({ where: { id: quizId, user_id: userId } });
    if (!quizRow) throw new NotFoundException({ error: 'Not found' });

    const questionIds = input.answers.map((a) => a.questionId);
    const questions = await this.prisma.question.findMany({
      where: { quiz_id: quizId, id: { in: questionIds } },
    });
    const qById = new Map(questions.map((q) => [q.id, q]));

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
          grade = await this.grader.gradeShort(
            q.prompt,
            q.correct_answer as string,
            ans.userAnswer,
          );
        } else {
          grade = { score: 0, feedback: 'Định dạng câu trả lời không hợp lệ.' };
        }
        return { q, grade };
      },
    );
    const graded = (await Promise.all(gradedPromises)).filter(
      (g): g is { q: QuestionRow; grade: GradeResult } => g !== null,
    );

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
            answer: answer === undefined ? Prisma.DbNull : (answer as Prisma.InputJsonValue),
            is_correct: r.score >= 0.5,
            answered_at: now,
          };
        });
      if (responseValues.length > 0) {
        await this.prisma.quiz_response.createMany({ data: responseValues });
      }
    }

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

    const correctCount = results.filter((r) => r.score >= 0.5).length;
    const xpAmount = correctCount * XP_AMOUNTS.QUIZ_ANSWER_CORRECT;
    let newAchievements: string[] = [];
    if (xpAmount > 0) {
      const awarded = await this.xp.awardXp(userId, xpAmount, {
        source: 'quiz',
        totalCount: 1,
      });
      newAchievements = awarded.newAchievements;
    }

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

    if (quizRow.workspace_id) {
      void this.outcome
        .recordQuizOutcome({
          userId,
          workspaceId: quizRow.workspace_id,
          percentage: percentage / 100,
          context: { score: totalScore, maxScore },
        })
        .catch(() => {});
    }

    return {
      results,
      summary: { totalScore, maxScore, percentage },
      xp: { awarded: xpAmount, newAchievements },
      verifyResult,
    };
  }
}
