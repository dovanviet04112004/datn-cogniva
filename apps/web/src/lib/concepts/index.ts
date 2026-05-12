/**
 * Concept extraction orchestrator — gọi extract + dedup cho từng chunk
 * và lưu vào pivot chunk_concept. Public API cho cả CLI script và auto-
 * trigger trong ingest pipeline.
 *
 * Luồng:
 *   1. Với mỗi chunk → extractConceptsFromChunk (LLM)
 *   2. Với mỗi concept → findOrCreateConcept (vector dedup)
 *   3. INSERT chunkConcept (chunkId, conceptId)
 *
 * Idempotent qua ON CONFLICT — chạy lại trên cùng chunk không tạo trùng.
 *
 * Concurrency: tuần tự để giữ Voyage RPM dưới rate limit (3/min free tier).
 * Nếu user upgrade Voyage → có thể wrap trong p-limit(3) parallel.
 */
import { eq, inArray } from 'drizzle-orm';

import { db, chunk, chunkConcept } from '@cogniva/db';

import { extractConceptsFromChunk } from './extract';
import { findOrCreateConcept } from './dedup';

export type ExtractStats = {
  /** Số chunks đã quét. */
  chunksProcessed: number;
  /** Tổng concept extracted (kể cả trùng). */
  conceptsExtracted: number;
  /** Số concept_id unique đã link vào chunk_concept. */
  linksCreated: number;
};

/**
 * Trích concepts cho 1 list chunk_id và lưu pivot links.
 *
 * @param chunkIds - Mảng chunk.id cần xử lý (thường là chunks của 1 document)
 * @param ctx - Optional, khi cung cấp dùng router cache (shared scope, 24h TTL).
 *              Cùng chunk content → cùng concepts. Tăng tốc re-ingest.
 */
export async function extractConceptsForChunks(
  chunkIds: string[],
  ctx?: { userId: string; plan: import('@/lib/observability/cost-guardrail').Plan },
): Promise<ExtractStats> {
  if (chunkIds.length === 0) {
    return { chunksProcessed: 0, conceptsExtracted: 0, linksCreated: 0 };
  }

  // Load nội dung — không lấy embedding vì không cần cho extract step
  const chunks = await db
    .select({ id: chunk.id, content: chunk.content })
    .from(chunk)
    .where(inArray(chunk.id, chunkIds));

  let conceptsExtracted = 0;
  let linksCreated = 0;

  for (const ch of chunks) {
    const extracted = await extractConceptsFromChunk(ch.content, ctx);
    conceptsExtracted += extracted.length;

    // Dedup tuần tự để không gọi Voyage embed song song (rate limit)
    for (const c of extracted) {
      try {
        const conceptId = await findOrCreateConcept(c);
        // INSERT pivot — onConflictDoNothing để chạy lại idempotent
        const inserted = await db
          .insert(chunkConcept)
          .values({ chunkId: ch.id, conceptId, strength: 1 })
          .onConflictDoNothing()
          .returning({ chunkId: chunkConcept.chunkId });
        if (inserted.length > 0) linksCreated++;
      } catch (err) {
        // Dedup failure → skip concept, log nhưng không crash batch
        console.warn(`[concepts] skip "${c.name}": ${(err as Error).message}`);
      }
    }
  }

  return {
    chunksProcessed: chunks.length,
    conceptsExtracted,
    linksCreated,
  };
}

/** Extract concepts cho toàn bộ chunks của 1 document. */
export async function extractConceptsForDocument(documentId: string): Promise<ExtractStats> {
  const rows = await db
    .select({ id: chunk.id })
    .from(chunk)
    .where(eq(chunk.documentId, documentId));
  return extractConceptsForChunks(rows.map((r) => r.id));
}

export { extractConceptsFromChunk } from './extract';
export { findOrCreateConcept, listAllConcepts, listConceptsForUser, type ConceptRow } from './dedup';
export { minePrerequisites, listConceptRelations } from './prerequisite';
