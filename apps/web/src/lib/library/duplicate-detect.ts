/**
 * library/duplicate-detect — Phase 2 Duplicate Detection (2026-05-27).
 *
 * Tìm docs trùng lặp với 1 source doc dựa trên cosine similarity của
 * title_embedding (1024-dim text-embedding-3-large).
 *
 * Threshold:
 *   - ≥ 0.92  → near-duplicate (gần chắc chắn cùng nội dung)
 *   - 0.85..0.92 → similar (cảnh báo nhưng cho upload)
 *   - < 0.85 → distinct
 *
 * Strategy:
 *   1. SQL ORDER BY title_embedding <=> source.title_embedding ASC LIMIT 5
 *   2. Filter result theo sim threshold + cùng subject (reduce false positive)
 *   3. (Optional) auto-create library_doc_report khi near-duplicate
 *
 * Spec: docs/plans/library-share.md §Phase 2 Moderation AI.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';

import { db, libraryDoc, libraryDocReport } from '@cogniva/db';

/** Cosine sim ≥ X coi như near-duplicate. */
export const NEAR_DUPLICATE_THRESHOLD = 0.92;
/** Cosine sim ≥ X coi như similar (cảnh báo). */
export const SIMILAR_THRESHOLD = 0.85;

export type DuplicateMatch = {
  id: string;
  title: string;
  subjectSlug: string;
  uploaderId: string;
  createdAt: Date;
  /** Cosine similarity 0..1 (1 = identical). */
  similarity: number;
  isNearDuplicate: boolean;
};

/**
 * Tìm docs tương tự với 1 source doc theo embedding.
 * @param threshold min similarity để return (default SIMILAR_THRESHOLD).
 */
export async function findDuplicateMatches(
  sourceDocId: string,
  threshold: number = SIMILAR_THRESHOLD,
): Promise<DuplicateMatch[]> {
  // ── 1. Fetch source doc embedding + meta ─────────────────────────────
  const [source] = await db
    .select({
      id: libraryDoc.id,
      titleEmbedding: libraryDoc.titleEmbedding,
      subjectSlug: libraryDoc.subjectSlug,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, sourceDocId))
    .limit(1);
  if (!source || !source.titleEmbedding) return [];

  // ── 2. Cosine search across other PUBLISHED docs cùng subject ───────
  // Postgres pgvector cosine distance: `<=>` (0=identical, 2=opposite).
  // Cosine similarity = 1 - distance/2 cho vector normalized hoặc 1 -
  // distance cho unit vector. text-embedding-3-large normalized → dùng
  // 1 - distance.
  const embeddingLiteral = `[${(source.titleEmbedding as number[]).join(',')}]`;
  const results = await db
    .select({
      id: libraryDoc.id,
      title: libraryDoc.title,
      subjectSlug: libraryDoc.subjectSlug,
      uploaderId: libraryDoc.uploaderId,
      createdAt: libraryDoc.createdAt,
      similarity: sql<number>`(1 - (${libraryDoc.titleEmbedding} <=> ${embeddingLiteral}::vector))::float`,
    })
    .from(libraryDoc)
    .where(
      and(
        eq(libraryDoc.status, 'PUBLISHED'),
        ne(libraryDoc.id, sourceDocId),
        eq(libraryDoc.subjectSlug, source.subjectSlug),
        sql`${libraryDoc.titleEmbedding} IS NOT NULL`,
      ),
    )
    .orderBy(sql`${libraryDoc.titleEmbedding} <=> ${embeddingLiteral}::vector`)
    .limit(5);

  return results
    .map((r) => ({
      id: r.id,
      title: r.title,
      subjectSlug: r.subjectSlug,
      uploaderId: r.uploaderId,
      createdAt: r.createdAt,
      similarity: Number(r.similarity),
      isNearDuplicate: Number(r.similarity) >= NEAR_DUPLICATE_THRESHOLD,
    }))
    .filter((r) => r.similarity >= threshold);
}

/**
 * Quét doc vừa ingested: nếu có near-duplicate → tự động tạo report admin.
 * Best-effort — fail không block ingest.
 *
 * @returns số reports đã tạo
 */
export async function autoFlagDuplicates(sourceDocId: string): Promise<number> {
  try {
    const matches = await findDuplicateMatches(sourceDocId, NEAR_DUPLICATE_THRESHOLD);
    if (matches.length === 0) return 0;

    const [source] = await db
      .select({ uploaderId: libraryDoc.uploaderId })
      .from(libraryDoc)
      .where(eq(libraryDoc.id, sourceDocId))
      .limit(1);
    if (!source) return 0;

    // Dedup: chỉ tạo 1 report tổng hợp tất cả matches
    const reportId = randomUUID();
    await db.insert(libraryDocReport).values({
      id: reportId,
      docId: sourceDocId,
      reporterId: source.uploaderId, // self-report (system flag), admin review
      reason: 'duplicate',
      detail: `Phát hiện ${matches.length} doc tương tự (sim ≥ ${NEAR_DUPLICATE_THRESHOLD}): ${matches
        .map((m) => `${m.id} (${(m.similarity * 100).toFixed(1)}%)`)
        .join(', ')}`,
      status: 'PENDING',
    });
    return 1;
  } catch (err) {
    console.error('[duplicate.autoFlag]', sourceDocId, err);
    return 0;
  }
}
