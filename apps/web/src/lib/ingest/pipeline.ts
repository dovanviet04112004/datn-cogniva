/**
 * Ingest pipeline orchestrator — keo dán parse + chunk + embed + save.
 *
 * Luồng:
 *   1. Load file từ storage (local FS / R2)
 *   2. Parse PDF → text từng trang
 *   3. Chunk thành đoạn ~512 token có overlap
 *   4. Embed batch qua OpenAI text-embedding-3-large @ 1536 dim
 *   5. Insert chunks vào DB
 *   6. Update document.status = READY
 *
 * Lỗi xử lý: bất kỳ exception nào → đặt status = FAILED và rethrow để
 * caller log. KHÔNG retry tự động ở phiên bản inline — Phase 1 next pass
 * sẽ chuyển sang BullMQ job và thêm retry policy.
 *
 * Phiên bản hiện tại (Phase 1 v1) chạy ĐỒNG BỘ trong route handler. PDF
 * lớn (>10 MB) sẽ block request — chấp nhận trade-off cho dev. Khi chuyển
 * sang BullMQ chỉ cần enqueue hàm này như một job trên queue `document`.
 */
import { eq } from 'drizzle-orm';

import { db, document, chunk } from '@cogniva/db';

import { chunkPages } from './chunk';
import { embedBatch } from './embed';
import { parsePdf } from './parse';
import { getStorage } from '../storage';
import { getDocumentQueue } from '@/queue/queues';
import { extractConceptsForDocument } from '@/lib/concepts';

/**
 * Chạy ingest end-to-end cho 1 document đã có sẵn record (status PROCESSING).
 *
 * @param documentId - ID document trong DB (đã được tạo bởi route upload)
 */
export async function ingestDocument(documentId: string): Promise<void> {
  const storage = getStorage();

  try {
    // ── 1. Load document record ─────────────────────────
    const docs = await db.select().from(document).where(eq(document.id, documentId)).limit(1);
    const doc = docs[0];
    if (!doc) throw new Error(`Document ${documentId} not found`);

    // ── 2. Tải file từ storage ──────────────────────────
    const buffer = await storage.get(doc.storageKey);

    // ── 3. Parse PDF ────────────────────────────────────
    if (doc.mimeType !== 'application/pdf') {
      throw new Error(
        `Unsupported mimeType: ${doc.mimeType}. Phase 1 chỉ hỗ trợ PDF; DOCX/URL/YouTube sẽ thêm sau.`,
      );
    }
    const parsed = await parsePdf(buffer);

    // ── 4. Chunk theo trang ─────────────────────────────
    const inputs = chunkPages(parsed.pages);
    if (inputs.length === 0) {
      throw new Error(
        'PDF không có text — có thể là scan ảnh. OCR fallback sẽ thêm ở iteration sau.',
      );
    }

    // ── 5. Embed batch ──────────────────────────────────
    const embeddings = await embedBatch(inputs.map((c) => c.content));

    // ── 6. Insert chunks ────────────────────────────────
    // Drizzle insert nhiều row trong 1 query → tránh N+1.
    // Phase A7: KHÔNG capture insertedChunks nữa — BullMQ job
    // `extract-document-concepts` tự query chunk theo documentId.
    await db.insert(chunk).values(
      inputs.map((input, i) => ({
        documentId,
        content: input.content,
        embedding: embeddings[i] ?? [],
        tokens: input.tokens,
        metadata: {
          chunkIndex: input.chunkIndex,
          page: input.page,
        },
      })),
    );

    // ── 7. Mark READY + cập nhật metadata ───────────────
    await db
      .update(document)
      .set({
        status: 'READY',
        metadata: {
          ...((doc.metadata as Record<string, unknown>) ?? {}),
          pageCount: parsed.totalPages,
        },
      })
      .where(eq(document.id, documentId));

    // ── 8. Phase A7 (atom-centric): enqueue BullMQ job extract-document-concepts ──
    // Delegate cho worker queue `document` (job `extract-document-concepts`):
    //   - Retry 3 lần exponential nếu LLM/Voyage fail (attempts=3)
    //   - Concurrency limit 2 song song (tránh Voyage rate limit free tier) — set ở worker
    //   - Backfill flashcard.concept_id cho card sinh trước khi atom extract xong
    //   - Idempotent: ON CONFLICT DO NOTHING ở pivot → retry không dup
    // jobId=documentId dedup. KHÔNG block upload response (best-effort). Nếu Redis down,
    // upload vẫn return 200; có thể enqueue lại sau.
    try {
      await getDocumentQueue().add(
        'extract-document-concepts',
        {
          documentId,
          userId: doc.userId,
          plan: 'FREE' as const, // Phase A: hardcode FREE; sau wire user.plan field
        },
        {
          jobId: documentId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
    } catch (err) {
      // Enqueue lỗi (vd Redis chết lúc upload) → trước đây document kẹt READY mà
      // KHÔNG BAO GIỜ có atom. Fallback: extract NGAY (đồng bộ, best-effort) để
      // không mất atom. Chậm hơn 1 lần hiếm hoi (Redis down) — chấp nhận. Lỗi
      // extract cũng không kéo cả ingest fail (chunks đã READY, chat vẫn chạy).
      console.warn(
        '[ingest] enqueue concept extraction lỗi → chạy inline fallback:',
        (err as Error).message,
      );
      try {
        await extractConceptsForDocument(documentId);
      } catch (inlineErr) {
        console.warn(
          '[ingest] inline concept extraction cũng lỗi:',
          (inlineErr as Error).message,
        );
      }
    }
  } catch (error) {
    // Đánh dấu FAILED rồi rethrow để caller log + xử lý
    await db
      .update(document)
      .set({ status: 'FAILED' })
      .where(eq(document.id, documentId));
    throw error;
  }
}
