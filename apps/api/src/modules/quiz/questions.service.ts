/**
 * QuestionsService — chấm 1 câu rời (QuickQuiz V5.2, cross-quiz). Port từ
 * apps/web/src/app/api/questions/[id]/grade/route.ts — GIỮ NGUYÊN wire shape.
 *
 * KHÔNG dùng LLM: so sánh strict (number) / case-insensitive trim (string) y cũ.
 * Mastery + marker đều best-effort (warn, không kill response).
 */
import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service';
import { MasteryUpdateService } from '../learning/mastery-update.service';

@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masteryUpdate: MasteryUpdateService,
  ) {}

  async gradeQuestion(userId: string, questionId: string, userAnswer: number | string) {
    const q = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!q) throw new NotFoundException({ error: 'Not found' });

    // correctAnswer jsonb: number (MCQ index) hoặc string (free text) — type
    // khác nhau → sai (như cũ, không coerce).
    const correctAnswer = q.correct_answer;
    let correct = false;
    if (typeof correctAnswer === 'number' && typeof userAnswer === 'number') {
      correct = correctAnswer === userAnswer;
    } else if (typeof correctAnswer === 'string' && typeof userAnswer === 'string') {
      correct = correctAnswer.trim().toLowerCase() === userAnswer.trim().toLowerCase();
    }

    // Update mastery — best-effort
    if (q.concept_id) {
      try {
        await this.masteryUpdate.applyAttempt(userId, q.concept_id, correct ? 1 : 0, 'quiz');
      } catch (err) {
        console.warn('[grade] applyAttempt fail:', err);
      }
    }

    // Marker "đã làm" cho trang quản trị — best-effort. UPSERT 1 marker
    // null-attempt / (user, câu) qua partial unique index
    // `quiz_response_user_question_quick_idx` (Prisma không model được partial
    // unique → raw SQL, ON CONFLICT y Drizzle cũ) — race-safe.
    try {
      const now = new Date();
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO "quiz_response" ("id", "attempt_id", "question_id", "user_id", "answer", "is_correct", "answered_at")
        VALUES (${randomUUID()}, NULL, ${questionId}, ${userId}, ${JSON.stringify(userAnswer)}::jsonb, ${correct}, ${now})
        ON CONFLICT ("user_id", "question_id") WHERE "attempt_id" IS NULL
        DO UPDATE SET "answer" = EXCLUDED."answer", "is_correct" = EXCLUDED."is_correct", "answered_at" = EXCLUDED."answered_at"
      `);
    } catch (err) {
      console.warn('[grade] quizResponse marker fail:', err);
    }

    return { correct, correctAnswer, explanation: q.explanation };
  }
}
