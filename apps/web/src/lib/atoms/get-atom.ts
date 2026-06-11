import { and, eq, sql } from 'drizzle-orm';

import { concept, db, flashcard, mastery, question, examQuestion } from '@cogniva/db';

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

export async function getAtomView(atomId: string, userId: string): Promise<AtomView | null> {
  const [conceptRow] = await db.select().from(concept).where(eq(concept.id, atomId)).limit(1);
  if (!conceptRow) return null;

  const [masteryRows, fcCount, qzCount, exCount] = await Promise.all([
    db
      .select()
      .from(mastery)
      .where(and(eq(mastery.userId, userId), eq(mastery.conceptId, atomId)))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(flashcard)
      .where(and(eq(flashcard.userId, userId), eq(flashcard.conceptId, atomId))),
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
