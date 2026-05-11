/**
 * Recommendation — gợi ý concept user nên học tiếp.
 *
 * Logic chấm điểm cho mỗi concept (cao → ưu tiên):
 *   priority = (1 - mastery)         // càng yếu càng ưu tiên
 *            * (1 + log(1 + prereqs_count))   // càng nhiều người khác phụ thuộc, càng quan trọng học sớm
 *            * (prereqs_mastered ? 1 : 0.3)   // chưa nắm prereq → giảm priority (chưa sẵn sàng)
 *
 * Top N concepts ranked by priority được trả về kèm "lý do" để hiển thị
 * trên UI ("Bạn yếu khái niệm X, mà X là tiền đề của 3 chủ đề khác").
 *
 * Phase 6 v1 đơn giản — chỉ dùng mastery + outgoing edges. Phase sau bổ sung
 * difficulty calibration + spacing.
 */
import { and, eq, inArray } from 'drizzle-orm';

import {
  db,
  concept,
  conceptRelation,
  mastery as masteryTable,
  chunkConcept,
  chunk,
  document,
} from '@cogniva/db';

import { INITIAL_SCORE } from './bkt';

export type Recommendation = {
  conceptId: string;
  conceptName: string;
  domain: string;
  mastery: number;
  /** Số khái niệm khác phụ thuộc vào concept này — cao = quan trọng. */
  prereqsFor: number;
  priority: number;
  /** Câu lý do để hiển thị UI. */
  reason: string;
};

/**
 * Lấy danh sách recommendation cho 1 user, top N theo priority.
 * Chỉ xét các concepts có trong tài liệu của user (qua chunk_concept ←→ document.userId).
 */
export async function getRecommendations(
  userId: string,
  limit = 10,
): Promise<Recommendation[]> {
  // Bước 1 — lấy concepts thuộc tài liệu của user
  const conceptRows = await db
    .selectDistinct({
      id: concept.id,
      name: concept.name,
      domain: concept.domain,
    })
    .from(concept)
    .innerJoin(chunkConcept, eq(chunkConcept.conceptId, concept.id))
    .innerJoin(chunk, eq(chunk.id, chunkConcept.chunkId))
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(eq(document.userId, userId));

  if (conceptRows.length === 0) return [];
  const conceptIds = conceptRows.map((c) => c.id);

  // Bước 2 — lấy mastery hiện tại
  const masteryRows = await db
    .select()
    .from(masteryTable)
    .where(
      and(
        eq(masteryTable.userId, userId),
        inArray(masteryTable.conceptId, conceptIds),
      ),
    );
  const masteryMap = new Map(masteryRows.map((m) => [m.conceptId, m.score]));

  // Bước 3 — đếm outgoing edges (concept này là prereq cho bao nhiêu concept khác)
  // Quan hệ PREREQUISITE_OF: from → to nghĩa là "from là tiền đề của to".
  const prereqRows = await db
    .select({ fromId: conceptRelation.fromId })
    .from(conceptRelation)
    .where(
      and(
        eq(conceptRelation.relationType, 'prerequisite'),
        inArray(conceptRelation.fromId, conceptIds),
      ),
    );
  const prereqCount = new Map<string, number>();
  for (const row of prereqRows) {
    prereqCount.set(row.fromId, (prereqCount.get(row.fromId) ?? 0) + 1);
  }

  // Bước 4 — tính priority + sinh reason
  const items: Recommendation[] = conceptRows.map((c) => {
    const score = masteryMap.get(c.id) ?? INITIAL_SCORE;
    const dependants = prereqCount.get(c.id) ?? 0;
    const weakness = 1 - score;
    const importance = 1 + Math.log(1 + dependants);
    const priority = weakness * importance;

    let reason: string;
    if (score < 0.4) {
      reason = `Mastery thấp (${(score * 100).toFixed(0)}%) — nên ưu tiên ôn.`;
    } else if (dependants > 0) {
      reason = `Là tiền đề của ${dependants} chủ đề khác — nắm vững giúp học các phần sau.`;
    } else {
      reason = `Mastery ${(score * 100).toFixed(0)}% — củng cố để giữ vững.`;
    }

    return {
      conceptId: c.id,
      conceptName: c.name,
      domain: c.domain,
      mastery: score,
      prereqsFor: dependants,
      priority,
      reason,
    };
  });

  items.sort((a, b) => b.priority - a.priority);
  return items.slice(0, limit);
}
