/**
 * AtomsService — AtomView (concept + mastery + counts) và items theo atom
 * (flashcards + quiz/exam questions). Port từ apps/web/src/app/api/atoms/[id]/**
 * + lib/atoms/get-atom.ts — GIỮ NGUYÊN wire shape camelCase + cùng cache key
 * `atomView` TTL 60s (bust qua onMasteryChanged(…, conceptId)).
 *
 * Atom là global (không scope user) nên không kiểm tra ownership — chỉ cần
 * userId để query mastery/flashcards của user.
 */
import { Injectable } from '@nestjs/common';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';

import { PrismaService } from '../../infra/database/prisma.service';

export type AtomView = {
  id: string;
  name: string;
  description: string | null;
  domain: string;
  examples: string[];
  difficulty: number | null;
  previewQuestion: string | null;
  previewAnswer: string | null;
  /** Mastery của user hiện tại — null nếu chưa attempt lần nào. */
  mastery: {
    score: number;
    attempts: number;
    correct: number;
    lastSeenAt: Date | null;
    lastQuizAt: Date | null;
    lastFlashcardAt: Date | null;
    lastExamAt: Date | null;
  } | null;
  counts: {
    flashcards: number;
    quizQuestions: number;
    examQuestions: number;
  };
};

@Injectable()
export class AtomsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /atoms/:id — cache-aside per-(user, atom) TTL 60s: nhiều click cùng
   * 1 atom → 1 lần query Neon. Date serialize ISO khi ghi cache → cache hit
   * trả string sẵn, đồng nhất với JSON response (như đường cũ).
   */
  async getAtomView(userId: string, atomId: string): Promise<AtomView | null> {
    return cached(ck.atomView(userId, atomId), 60, () => this.fetchAtomView(atomId, userId));
  }

  /** Load AtomView từ DB — 1 query concept + 4 query song song (như lib cũ). */
  private async fetchAtomView(atomId: string, userId: string): Promise<AtomView | null> {
    const conceptRow = await this.prisma.concept.findUnique({ where: { id: atomId } });
    if (!conceptRow) return null;

    const [masteryRow, fcCount, qzCount, exCount] = await Promise.all([
      this.prisma.mastery.findFirst({ where: { user_id: userId, concept_id: atomId } }),
      this.prisma.flashcard.count({ where: { user_id: userId, concept_id: atomId } }),
      this.prisma.question.count({ where: { concept_id: atomId } }),
      this.prisma.exam_question.count({ where: { concept_id: atomId } }),
    ]);

    return {
      id: conceptRow.id,
      name: conceptRow.name,
      description: conceptRow.description,
      domain: conceptRow.domain,
      examples: (conceptRow.examples as unknown as string[]) ?? [],
      difficulty: conceptRow.difficulty,
      previewQuestion: conceptRow.preview_question,
      previewAnswer: conceptRow.preview_answer,
      mastery: masteryRow
        ? {
            score: masteryRow.score,
            attempts: masteryRow.attempts,
            correct: masteryRow.correct,
            lastSeenAt: masteryRow.last_seen_at,
            lastQuizAt: masteryRow.last_quiz_at,
            lastFlashcardAt: masteryRow.last_flashcard_at,
            lastExamAt: masteryRow.last_exam_at,
          }
        : null,
      counts: {
        flashcards: fcCount,
        quizQuestions: qzCount,
        examQuestions: exCount,
      },
    };
  }

  /**
   * GET /atoms/:id/items — flashcards (của user) + quiz questions + exam
   * questions của 1 atom; optional ?workspaceId scope. Quiz/exam KHÔNG scope
   * user (có thể share). Trả null nếu atom không tồn tại (controller → 404).
   */
  async getAtomItems(userId: string, atomId: string, workspaceId: string | null) {
    const atomRow = await this.prisma.concept.findUnique({
      where: { id: atomId },
      select: { id: true },
    });
    if (!atomRow) return null;

    const [flashcards, quizQuestions, examQuestions] = await Promise.all([
      // Flashcards của user, optional scope workspace — order due ASC.
      this.prisma.flashcard.findMany({
        where: {
          user_id: userId,
          concept_id: atomId,
          ...(workspaceId ? { workspace_id: workspaceId } : {}),
        },
        select: {
          id: true,
          front: true,
          back: true,
          card_type: true,
          state: true,
          due: true,
          last_review: true,
        },
        orderBy: { due: 'asc' },
        take: 50,
      }),
      // Quiz questions kèm parent quiz info — optional scope theo quiz.workspaceId.
      this.prisma.question.findMany({
        where: {
          concept_id: atomId,
          ...(workspaceId ? { quiz: { workspace_id: workspaceId } } : {}),
        },
        select: {
          id: true,
          prompt: true,
          type: true,
          options: true,
          quiz: { select: { id: true, title: true, created_at: true } },
        },
        orderBy: { quiz: { created_at: 'desc' } },
        take: 50,
      }),
      // Exam questions kèm parent exam info — optional scope workspace.
      this.prisma.exam_question.findMany({
        where: {
          concept_id: atomId,
          ...(workspaceId ? { exam: { workspace_id: workspaceId } } : {}),
        },
        select: {
          id: true,
          prompt: true,
          type: true,
          exam: { select: { id: true, title: true } },
        },
        orderBy: { exam: { created_at: 'desc' } },
        take: 50,
      }),
    ]);

    return {
      flashcards: flashcards.map((f) => ({
        id: f.id,
        front: f.front,
        back: f.back,
        cardType: f.card_type,
        state: f.state,
        due: f.due,
        lastReview: f.last_review,
      })),
      quizQuestions: quizQuestions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        type: q.type,
        options: q.options,
        quizId: q.quiz.id,
        quizTitle: q.quiz.title,
        quizCreatedAt: q.quiz.created_at,
      })),
      examQuestions: examQuestions.map((e) => ({
        id: e.id,
        prompt: e.prompt,
        type: e.type,
        examId: e.exam.id,
        examTitle: e.exam.title,
      })),
    };
  }
}
