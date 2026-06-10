/**
 * BullMQ job `extract-document-concepts` — Phase A7 (atom-centric).
 *
 * Chạy bởi worker; lịch/trigger ở src/queue/jobs.ts + src/worker. Job được
 * enqueue lên queue `document` sau khi `ingestDocument()` (lib/ingest/pipeline.ts)
 * chunk + embed xong + document.status=READY.
 *
 * Pipeline:
 *   1. Load chunks của document
 *   2. extractConceptsForChunks (LLM extract atom + embed dedup + INSERT
 *      chunk_concept pivot)
 *   3. (Optional) backfill flashcard.concept_id cho card đã sinh từ
 *      document này nhưng chưa link concept — tránh race: nếu user gen
 *      flashcard trước khi atom extract xong, card sẽ có conceptId=NULL.
 *
 * Idempotent: extractConceptsForChunks dùng ON CONFLICT DO NOTHING ở pivot
 * → chạy lại không dup. Backfill UPDATE flashcard cũng idempotent (chỉ
 * UPDATE rows NULL). Vì job an toàn re-run, whole-job retry của BullMQ không
 * gây dup. Lỗi LLM 1 chunk không kill batch (extractConceptsFromChunk đã
 * catch nội bộ).
 */
import { and, eq, isNull, inArray } from 'drizzle-orm';

import { db, chunk, chunkConcept, document, flashcard } from '@cogniva/db';

import { extractConceptsForChunks } from '@/lib/concepts';
import { logger } from '@/lib/observability/logger';

import type { DocumentJob } from '@/queue/jobs';

export async function extractDocumentConcepts(data: DocumentJob) {
  const { documentId, userId, plan } = data;

  // Step 1: verify document tồn tại + ready (anti race với delete)
  const [doc] = await db
    .select({ id: document.id, status: document.status })
    .from(document)
    .where(eq(document.id, documentId))
    .limit(1);

  if (!doc) {
    logger.info('document not found, skip extract', { documentId });
    return { skipped: 'document-not-found' };
  }
  if (doc.status !== 'READY') {
    logger.info('document not ready, skip extract', {
      documentId,
      status: doc.status,
    });
    return { skipped: 'document-not-ready' };
  }

  // Step 2: load chunk ids
  const chunkRows = await db
    .select({ id: chunk.id })
    .from(chunk)
    .where(eq(chunk.documentId, documentId));
  const chunkIds = chunkRows.map((r) => r.id);

  if (chunkIds.length === 0) {
    return { chunksProcessed: 0, conceptsExtracted: 0, linksCreated: 0 };
  }

  // Step 3: extract (LLM + embed + dedup + INSERT pivot)
  const stats = await extractConceptsForChunks(chunkIds, { userId, plan });

  // Step 4: backfill flashcard.concept_id cho card đã sinh trước khi
  // extract xong. Race window: user upload PDF → ingest sync → user bấm
  // "AI gen flashcard" ngay → card có sourceChunkId nhưng conceptId NULL
  // (lúc đó pivot chưa có). Backfill bây giờ qua cùng query với migration
  // 0032.
  const backfilled = await (async () => {
    // Lấy chunk_ids có concept link
    const linkedChunks = await db
      .selectDistinct({ chunkId: chunkConcept.chunkId })
      .from(chunkConcept)
      .where(inArray(chunkConcept.chunkId, chunkIds));
    if (linkedChunks.length === 0) return 0;

    // Build map chunk → strongest concept
    const links = await db
      .select({
        chunkId: chunkConcept.chunkId,
        conceptId: chunkConcept.conceptId,
        strength: chunkConcept.strength,
      })
      .from(chunkConcept)
      .where(
        inArray(
          chunkConcept.chunkId,
          linkedChunks.map((c) => c.chunkId),
        ),
      );
    const chunkToConcept = new Map<string, string>();
    for (const l of links) {
      if (!chunkToConcept.has(l.chunkId)) {
        chunkToConcept.set(l.chunkId, l.conceptId);
      }
    }

    // UPDATE từng chunk (số chunk thường ~50-200 — chấp nhận N query
    // cho rõ ràng; nếu cần optimise dùng CASE WHEN bulk update)
    let count = 0;
    for (const [chId, conceptId] of chunkToConcept) {
      const updated = await db
        .update(flashcard)
        .set({ conceptId })
        .where(
          and(eq(flashcard.sourceChunkId, chId), isNull(flashcard.conceptId)),
        )
        .returning({ id: flashcard.id });
      count += updated.length;
    }
    return count;
  })();

  logger.info('document concepts extracted', {
    documentId,
    ...stats,
    flashcardsBackfilled: backfilled,
  });
  return { ...stats, flashcardsBackfilled: backfilled };
}
