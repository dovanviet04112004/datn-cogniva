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

  async getAtomView(userId: string, atomId: string): Promise<AtomView | null> {
    return cached(ck.atomView(userId, atomId), 60, () => this.fetchAtomView(atomId, userId));
  }

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

  async getAtomItems(userId: string, atomId: string, workspaceId: string | null) {
    const atomRow = await this.prisma.concept.findUnique({
      where: { id: atomId },
      select: { id: true },
    });
    if (!atomRow) return null;

    const [flashcards, quizQuestions, examQuestions] = await Promise.all([
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
