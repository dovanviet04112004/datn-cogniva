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
 * sẽ swap sang Inngest và thêm retry policy.
 *
 * Phiên bản hiện tại (Phase 1 v1) chạy ĐỒNG BỘ trong route handler. PDF
 * lớn (>10 MB) sẽ block request — chấp nhận trade-off cho dev. Khi swap
 * sang Inngest chỉ cần wrap hàm này trong `inngest.createFunction(...)`.
 */
import { eq } from 'drizzle-orm';

import { db, document, chunk } from '@cogniva/db';

import { chunkPages } from './chunk';
import { embedBatch } from './embed';
import { parsePdf } from './parse';
import { getStorage } from '../storage';

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
    // Drizzle insert nhiều row trong 1 query → tránh N+1
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
  } catch (error) {
    // Đánh dấu FAILED rồi rethrow để caller log + xử lý
    await db
      .update(document)
      .set({ status: 'FAILED' })
      .where(eq(document.id, documentId));
    throw error;
  }
}
