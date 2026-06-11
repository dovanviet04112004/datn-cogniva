import { and, asc, eq, exists, inArray, lt, sql } from 'drizzle-orm';

import {
  chunk,
  chunkConcept,
  concept,
  db,
  document,
  flashcard,
  mastery,
  question,
} from '@cogniva/db';

export type AtomBrief = {
  id: string;
  name: string;
  description: string | null;
  domain: string;
  difficulty: number | null;
  previewQuestion: string | null;
  previewAnswer: string | null;
  flashcardCount: number;
  questionCount: number;
  masteryScore: number | null;
  earliestDue: Date | null;
};

export type StudyPlanProposal = {
  review: AtomBrief[];
  newAtoms: AtomBrief[];
  practice: AtomBrief[];
};

const REVIEW_LIMIT = 5;
const NEW_LIMIT = 2;
const PRACTICE_LIMIT = 3;

export async function proposeForToday(
  userId: string,
  workspaceId?: string,
): Promise<StudyPlanProposal> {
  const now = new Date();

  const reviewRows = await db
    .select({
      conceptId: flashcard.conceptId,
      earliestDue: sql<Date>`MIN(${flashcard.due})`.as('earliest_due'),
    })
    .from(flashcard)
    .where(
      and(
        eq(flashcard.userId, userId),
        lt(flashcard.due, now),
        workspaceId ? eq(flashcard.workspaceId, workspaceId) : undefined,
        sql`${flashcard.conceptId} IS NOT NULL`,
      ),
    )
    .groupBy(flashcard.conceptId)
    .orderBy(asc(sql`MIN(${flashcard.due})`))
    .limit(REVIEW_LIMIT);

  const reviewConceptIds = reviewRows
    .map((r) => r.conceptId)
    .filter((id): id is string => id !== null);

  const conceptInUserDocs = db
    .selectDistinct({ id: chunkConcept.conceptId })
    .from(chunkConcept)
    .innerJoin(chunk, eq(chunk.id, chunkConcept.chunkId))
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(
      and(
        eq(document.userId, userId),
        workspaceId ? eq(document.workspaceId, workspaceId) : undefined,
      ),
    );

  const newAtomRows = await db
    .select()
    .from(concept)
    .where(
      and(
        inArray(concept.id, conceptInUserDocs),
        sql`NOT EXISTS (
          SELECT 1 FROM mastery m
          WHERE m.user_id = ${userId}
            AND m.concept_id = ${concept.id}
        )`,
      ),
    )
    .orderBy(sql`${concept.difficulty} ASC NULLS LAST`)
    .limit(NEW_LIMIT);

  const practiceRows = await db
    .select({
      conceptId: mastery.conceptId,
      score: mastery.score,
    })
    .from(mastery)
    .where(
      and(
        eq(mastery.userId, userId),
        lt(mastery.score, 0.5),
        exists(
          db
            .select({ x: sql<number>`1` })
            .from(question)
            .where(eq(question.conceptId, mastery.conceptId)),
        ),
      ),
    )
    .orderBy(asc(mastery.score))
    .limit(PRACTICE_LIMIT);

  const practiceConceptIds = practiceRows.map((r) => r.conceptId);

  const allConceptIds = Array.from(
    new Set([...reviewConceptIds, ...newAtomRows.map((c) => c.id), ...practiceConceptIds]),
  );

  const briefs: Map<string, AtomBrief> = new Map();
  if (allConceptIds.length > 0) {
    const conceptRows = await db.select().from(concept).where(inArray(concept.id, allConceptIds));

    const masteryRows = await db
      .select()
      .from(mastery)
      .where(and(eq(mastery.userId, userId), inArray(mastery.conceptId, allConceptIds)));
    const masteryMap = new Map(masteryRows.map((m) => [m.conceptId, m.score]));

    const fcCounts = await db
      .select({
        conceptId: flashcard.conceptId,
        n: sql<number>`COUNT(*)::int`.as('n'),
      })
      .from(flashcard)
      .where(and(eq(flashcard.userId, userId), inArray(flashcard.conceptId, allConceptIds)))
      .groupBy(flashcard.conceptId);
    const fcMap = new Map<string, number>();
    for (const c of fcCounts) {
      if (c.conceptId !== null) fcMap.set(c.conceptId, c.n);
    }

    const qCounts = await db
      .select({
        conceptId: question.conceptId,
        n: sql<number>`COUNT(*)::int`.as('n'),
      })
      .from(question)
      .where(inArray(question.conceptId, allConceptIds))
      .groupBy(question.conceptId);
    const qMap = new Map<string, number>();
    for (const c of qCounts) {
      if (c.conceptId !== null) qMap.set(c.conceptId, c.n);
    }

    const dueMap = new Map<string, Date>();
    for (const r of reviewRows) {
      if (r.conceptId !== null) dueMap.set(r.conceptId, new Date(r.earliestDue));
    }

    for (const c of conceptRows) {
      briefs.set(c.id, {
        id: c.id,
        name: c.name,
        description: c.description,
        domain: c.domain,
        difficulty: c.difficulty,
        previewQuestion: c.previewQuestion,
        previewAnswer: c.previewAnswer,
        flashcardCount: fcMap.get(c.id) ?? 0,
        questionCount: qMap.get(c.id) ?? 0,
        masteryScore: masteryMap.get(c.id) ?? null,
        earliestDue: dueMap.get(c.id) ?? null,
      });
    }
  }

  return {
    review: reviewConceptIds
      .map((id) => briefs.get(id))
      .filter((b): b is AtomBrief => b !== undefined),
    newAtoms: newAtomRows
      .map((c) => briefs.get(c.id))
      .filter((b): b is AtomBrief => b !== undefined),
    practice: practiceConceptIds
      .map((id) => briefs.get(id))
      .filter((b): b is AtomBrief => b !== undefined),
  };
}
