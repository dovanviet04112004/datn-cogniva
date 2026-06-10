/**
 * AtomView helper — Phase A8 (atom-centric).
 *
 * Trả về 1 atom với mastery của user + count flashcard/quiz/exam. Dùng cho
 * UI atom detail page (Phase C4) + workspace "Today" card (Phase B).
 *
 * Spec: docs/plans/atom-centric.md §3.4 (atom_view).
 *
 * Implementation note: làm bằng tay (không CREATE VIEW SQL) để Drizzle có
 * thể type-safe. Cost: 4 query song song (concept, mastery, flashcard count,
 * quiz count) — chấp nhận vì atom detail không phải hot path.
 */
import { and, eq, sql } from 'drizzle-orm';

import {
  concept,
  db,
  flashcard,
  mastery,
  question,
  examQuestion,
} from '@cogniva/db';

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

/**
 * Load AtomView cho 1 atom (concept) của 1 user.
 *
 * @returns AtomView hoặc null nếu concept không tồn tại.
 */
export async function getAtomView(
  atomId: string,
  userId: string,
): Promise<AtomView | null> {
  const [conceptRow] = await db
    .select()
    .from(concept)
    .where(eq(concept.id, atomId))
    .limit(1);
  if (!conceptRow) return null;

  // Parallel — independent queries
  const [masteryRows, fcCount, qzCount, exCount] = await Promise.all([
    db
      .select()
      .from(mastery)
      .where(and(eq(mastery.userId, userId), eq(mastery.conceptId, atomId)))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(flashcard)
      .where(
        and(eq(flashcard.userId, userId), eq(flashcard.conceptId, atomId)),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(question)
      .where(eq(question.conceptId, atomId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(examQuestion)
      .where(eq(examQuestion.conceptId, atomId)),
  ]);

  const m = masteryRows[0];

  return {
    id: conceptRow.id,
    name: conceptRow.name,
    description: conceptRow.description,
    domain: conceptRow.domain,
    examples: (conceptRow.examples as string[]) ?? [],
    difficulty: conceptRow.difficulty,
    previewQuestion: conceptRow.previewQuestion,
    previewAnswer: conceptRow.previewAnswer,
    mastery: m
      ? {
          score: m.score,
          attempts: m.attempts,
          correct: m.correct,
          lastSeenAt: m.lastSeenAt,
          lastQuizAt: m.lastQuizAt,
          lastFlashcardAt: m.lastFlashcardAt,
          lastExamAt: m.lastExamAt,
        }
      : null,
    counts: {
      flashcards: fcCount[0]?.count ?? 0,
      quizQuestions: qzCount[0]?.count ?? 0,
      examQuestions: exCount[0]?.count ?? 0,
    },
  };
}
