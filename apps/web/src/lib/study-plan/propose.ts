/**
 * Study Plan AI proposal — Phase B (atom-centric).
 *
 * Spec: docs/plans/atom-centric.md §4.6 + §6 Phase B.
 *
 * Sinh proposal cho 1 user (optionally scoped 1 workspace), gồm 3 nhóm:
 *
 *   1. REVIEW  — atom có flashcard due (SRS overdue). Top 5 by oldest due.
 *      → User cần ôn lại trước khi quên hẳn.
 *
 *   2. NEW     — atom chưa có mastery row (chưa attempt lần nào), nhưng
 *                concept đã được link với chunk trong document của user
 *                (qua document → chunk → chunk_concept). Top 1-2 by
 *                difficulty ASC NULLS LAST (dễ trước).
 *      → Mở rộng kiến thức theo cách dễ tiếp cận.
 *
 *   3. PRACTICE — atom yếu (mastery.score < 0.5), order ASC. Top 3.
 *                Chỉ chọn atom có ≥ 1 question (để render thành quiz).
 *      → Củng cố điểm yếu.
 *
 * Function này CHỈ tính toán proposal — KHÔNG insert. Caller (Phase B
 * materialize) sẽ INSERT vào `study_plan_item` nếu chưa có today.
 *
 * Performance: 3 query parallel, mỗi query trả ~10 rows max → tổng < 100ms.
 */
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

/** Tóm tắt 1 atom đủ để hiển thị card preview trong UI. */
export type AtomBrief = {
  id: string;
  name: string;
  description: string | null;
  domain: string;
  difficulty: number | null;
  previewQuestion: string | null;
  previewAnswer: string | null;
  /** Số flashcard / quiz item user đã có cho atom — dùng decide format render. */
  flashcardCount: number;
  questionCount: number;
  /** Mastery score hiện tại (0..1). Null nếu chưa attempt. */
  masteryScore: number | null;
  /** Flashcard due gần nhất — null nếu không có flashcard hoặc chưa due. */
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

/**
 * Sinh proposal hôm nay cho 1 user.
 *
 * @param userId    - User cần propose
 * @param workspaceId - Optional, scope theo workspace (cho TodayCard ở
 *                    workspace detail). Bỏ trống = tất cả workspace.
 */
export async function proposeForToday(
  userId: string,
  workspaceId?: string,
): Promise<StudyPlanProposal> {
  const now = new Date();

  // ──────────────────────────────────────────────────────────────
  // 1. REVIEW — atoms có flashcard due
  // ──────────────────────────────────────────────────────────────
  // Group flashcard by concept_id, lấy concept có ≥ 1 card due:
  //   conceptId | earliest_due | card_count
  // Order earliest_due ASC (overdue lâu nhất lên trước).
  //
  // Workspace scope: filter flashcard.workspaceId nếu có.
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
        // Phải có conceptId — flashcard chưa link atom thì không vào proposal
        sql`${flashcard.conceptId} IS NOT NULL`,
      ),
    )
    .groupBy(flashcard.conceptId)
    .orderBy(asc(sql`MIN(${flashcard.due})`))
    .limit(REVIEW_LIMIT);

  const reviewConceptIds = reviewRows
    .map((r) => r.conceptId)
    .filter((id): id is string => id !== null);

  // ──────────────────────────────────────────────────────────────
  // 2. NEW — atoms chưa có mastery row, link với chunk trong doc của user
  // ──────────────────────────────────────────────────────────────
  // Sub-query: concept đã link chunk → document của user (optionally
  // workspace). EXCLUDE concept user đã có mastery.
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
        // KHÔNG có mastery row cho user × concept này
        sql`NOT EXISTS (
          SELECT 1 FROM mastery m
          WHERE m.user_id = ${userId}
            AND m.concept_id = ${concept.id}
        )`,
      ),
    )
    .orderBy(sql`${concept.difficulty} ASC NULLS LAST`)
    .limit(NEW_LIMIT);

  // ──────────────────────────────────────────────────────────────
  // 3. PRACTICE — atom yếu (mastery.score < 0.5) có ≥ 1 question
  // ──────────────────────────────────────────────────────────────
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
        // Chỉ chọn concept có ≥ 1 question (để render quiz)
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

  // ──────────────────────────────────────────────────────────────
  // Hydrate AtomBrief — 1 query join concept + counts + mastery score
  // ──────────────────────────────────────────────────────────────
  const allConceptIds = Array.from(
    new Set([
      ...reviewConceptIds,
      ...newAtomRows.map((c) => c.id),
      ...practiceConceptIds,
    ]),
  );

  const briefs: Map<string, AtomBrief> = new Map();
  if (allConceptIds.length > 0) {
    const conceptRows = await db
      .select()
      .from(concept)
      .where(inArray(concept.id, allConceptIds));

    // Mastery scores batch
    const masteryRows = await db
      .select()
      .from(mastery)
      .where(
        and(
          eq(mastery.userId, userId),
          inArray(mastery.conceptId, allConceptIds),
        ),
      );
    const masteryMap = new Map(masteryRows.map((m) => [m.conceptId, m.score]));

    // Counts: flashcard + question — 2 query GROUP BY
    const fcCounts = await db
      .select({
        conceptId: flashcard.conceptId,
        n: sql<number>`COUNT(*)::int`.as('n'),
      })
      .from(flashcard)
      .where(
        and(
          eq(flashcard.userId, userId),
          inArray(flashcard.conceptId, allConceptIds),
        ),
      )
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

    // Build map review.earliestDue.
    // MIN(due) là raw SQL (sql<Date>) → Drizzle KHÔNG map type, driver có thể
    // trả string lúc runtime → ép về Date thật để consumer (buildRow gọi
    // .toISOString()) không vỡ. new Date(Date) cũng an toàn (clone).
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
