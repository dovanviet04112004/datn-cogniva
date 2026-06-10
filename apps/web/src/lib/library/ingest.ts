/**
 * library/ingest — V1 (2026-05-22).
 *
 * Post-upload pipeline. Sau khi user upload file lên R2 + INSERT library_doc
 * (status=PROCESSING), gọi `ingestLibraryDoc(docId)` để:
 *   1. Download file từ R2 (bytes)
 *   2. Parse text per page + generate thumbnail (parsers.ts)
 *   3. Upload thumbnail lên R2 → update preview_thumb_url
 *   4. Chunk text per page → embed → INSERT library_doc_chunk rows
 *   5. Embed title+desc+summary → UPDATE title_embedding
 *   6. Generate AI summary 200 từ → UPDATE ai_summary
 *   7. UPDATE preview_text + page_count
 *   8. UPDATE status = PUBLISHED
 *
 * Lưu ý: chạy serial trong 1 hàm. Phase 2 sẽ wrap qua BullMQ job để retry.
 *
 * Spec: docs/plans/library-share.md §Indexing Pipeline.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db, libraryDoc, libraryDocChunk } from '@cogniva/db';

import { embedBatch } from '@/lib/ingest/embed';
import { embedQuery } from '@/lib/ingest/embed-query';
import { routedGenerateText } from '@/lib/ai/router';
import {
  getR2Object,
  getPublicUrl,
  putR2Object,
} from '@/lib/r2-client';

import { chunkPageText, parseFile } from './parsers';

/**
 * Run ingest pipeline cho 1 doc. Idempotent: nếu đã có chunks cũ thì xoá trước.
 *
 * Throws nếu file không parse được → caller (job) sẽ UPDATE status=FAILED.
 */
export async function ingestLibraryDoc(docId: string): Promise<void> {
  // ── 0. Fetch doc record ────────────────────────────────────────────
  const [doc] = await db
    .select()
    .from(libraryDoc)
    .where(eq(libraryDoc.id, docId))
    .limit(1);
  if (!doc) throw new Error(`libraryDoc not found: ${docId}`);
  if (doc.status === 'PUBLISHED') {
    console.warn(`[ingest] doc ${docId} already PUBLISHED, re-ingesting`);
  }

  // R2 key encoded trong file_url. Pattern: "lib/{uploaderId}/{docId}.{ext}"
  const r2Key = extractR2Key(doc.fileUrl);
  if (!r2Key) throw new Error('Không trích xuất được R2 key từ file_url');

  // ── 1. Download file từ R2 ─────────────────────────────────────────
  const buffer = await getR2Object(r2Key);

  // ── 2. Parse theo format ───────────────────────────────────────────
  const fmt = doc.fileFormat as 'pdf' | 'docx' | 'image';
  const mimeType = inferMimeType(doc.fileUrl, fmt);
  const parsed = await parseFile(buffer, fmt, mimeType);

  // ── 3. Upload thumbnail lên R2 ─────────────────────────────────────
  const thumbKey = `lib/${doc.uploaderId}/${docId}-thumb.jpg`;
  await putR2Object(thumbKey, parsed.thumbnailJpeg, 'image/jpeg');
  const thumbUrl = getPublicUrl(thumbKey);

  // ── 4. Chunk + embed mọi page parallel ─────────────────────────────
  // Xoá chunks cũ nếu re-ingest
  await db.delete(libraryDocChunk).where(eq(libraryDocChunk.docId, docId));

  // Tổng hợp tất cả chunks + giữ metadata pageNum/chunkIndex
  type ChunkSpec = {
    pageNum: number;
    chunkIndex: number;
    content: string;
  };
  const chunkSpecs: ChunkSpec[] = [];
  for (const page of parsed.pages) {
    const chunks = chunkPageText(page.text);
    for (let i = 0; i < chunks.length; i++) {
      chunkSpecs.push({
        pageNum: page.pageNum,
        chunkIndex: i,
        content: chunks[i]!,
      });
    }
  }

  // Embed batch (embedBatch handles batching internally)
  if (chunkSpecs.length > 0) {
    const texts = chunkSpecs.map((c) => c.content);
    const embeddings = await embedBatch(texts);

    // INSERT rows in batch
    const insertRows = chunkSpecs.map((c, idx) => ({
      id: randomUUID(),
      docId,
      pageNum: c.pageNum,
      chunkIndex: c.chunkIndex,
      content: c.content,
      contentVec: embeddings[idx] ?? null,
    }));

    // Drizzle insert nhiều rows — chia thành batch 100 để tránh query quá lớn
    const BATCH = 100;
    for (let i = 0; i < insertRows.length; i += BATCH) {
      await db.insert(libraryDocChunk).values(insertRows.slice(i, i + BATCH));
    }
  }

  // ── 5. Generate AI summary 200 từ ──────────────────────────────────
  let aiSummary: string | null = null;
  try {
    // Lấy text 5 trang đầu (~ 5000 chars)
    const firstPagesText = parsed.pages
      .slice(0, 5)
      .map((p) => p.text)
      .join('\n\n')
      .slice(0, 5000);

    if (firstPagesText.length > 200) {
      const { text } = await routedGenerateText({
        useCase: 'summarize',
        userId: doc.uploaderId,
        plan: 'FREE',
        system: `Bạn viết tóm tắt tài liệu học tập tiếng Việt 150-200 từ.
Phong cách thân thiện, mô tả nội dung chính + đối tượng phù hợp.
KHÔNG dùng markdown, KHÔNG bullet points, viết 1-2 đoạn liền mạch.`,
        messages: [
          {
            role: 'user',
            content: `Tài liệu: "${doc.title}"\nMôn: ${doc.subjectSlug}\nLoại: ${doc.docType}\n\nNội dung (trích 5 trang đầu):\n${firstPagesText}\n\nViết tóm tắt 150-200 từ.`,
          },
        ],
        maxOutputTokens: 400,
        feature: 'library.ingest.summary',
      });
      aiSummary = text.trim();
    }
  } catch (err) {
    console.error('[ingest.summary]', err);
  }

  // ── 6. Embed title + desc + summary cho search-vec doc-level ──────
  const titleText = [
    doc.title,
    doc.description ?? '',
    aiSummary ?? '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
  let titleEmbedding: number[] | null = null;
  try {
    titleEmbedding = await embedQuery(titleText);
  } catch (err) {
    console.error('[ingest.title-embed]', err);
  }

  // ── 7. Preview text 500 char đầu ──────────────────────────────────
  const previewText = parsed.fullText.slice(0, 500);

  // ── 8. UPDATE doc → PUBLISHED ──────────────────────────────────────
  await db
    .update(libraryDoc)
    .set({
      status: 'PUBLISHED',
      previewThumbUrl: thumbUrl,
      previewText,
      pageCount: parsed.pageCount,
      aiSummary,
      aiSummaryAt: aiSummary ? new Date() : null,
      ...(titleEmbedding ? { titleEmbedding } : {}),
      updatedAt: new Date(),
    })
    .where(eq(libraryDoc.id, docId));

  // ── 9. Phase 2: trigger atom extraction (Pillar #3) async ──────────
  // Chạy sau PUBLISHED + không block — atom fail không làm hỏng doc.
  // Lazy import để không kéo Z deps + LLM cost vào main ingest bundle.
  void (async () => {
    try {
      const { extractAtomsForDoc } = await import('./atom-extractor');
      const result = await extractAtomsForDoc(docId);
      console.log(
        `[ingest.atoms] doc=${docId} atoms=${result.atomsInserted} cost=$${result.costUsd.toFixed(4)}`,
      );
    } catch (err) {
      console.error('[ingest.atoms]', docId, err);
    }
  })();

  // ── 10. Phase 2: duplicate detection async ─────────────────────────
  // Quét title_embedding cùng môn — nếu sim ≥ 0.92 thì tự tạo report
  // admin queue. Không hide doc auto, admin review case-by-case.
  void (async () => {
    try {
      const { autoFlagDuplicates } = await import('./duplicate-detect');
      const flagged = await autoFlagDuplicates(docId);
      if (flagged > 0) {
        console.log(`[ingest.dup-detect] doc=${docId} flagged for admin review`);
      }
    } catch (err) {
      console.error('[ingest.dup-detect]', docId, err);
    }
  })();

  // ── 11. Phase 3 Bonus #13: difficulty + prerequisite chain async ───
  // Phụ thuộc atoms đã extract (step 9). Delay ngắn để atom job chạy
  // trước. Best-effort.
  void (async () => {
    try {
      await new Promise((r) => setTimeout(r, 8000)); // chờ atom extract
      const { recomputeDifficultyAndPrereqForDoc } = await import('./difficulty-prereq');
      const result = await recomputeDifficultyAndPrereqForDoc(docId);
      console.log(
        `[ingest.diff-prereq] doc=${docId} diff=${result.difficulty} prereq=${result.prereqSlugs.length}`,
      );
    } catch (err) {
      console.error('[ingest.diff-prereq]', docId, err);
    }
  })();
}

// ─── Utility ─────────────────────────────────────────────────────────
function extractR2Key(fileUrl: string): string | null {
  // file_url pattern: https://lib.cogniva.dev/lib/{uid}/{docId}.{ext}
  // hoặc presigned URL có /lib/...
  const match = fileUrl.match(/\/(lib\/[^/]+\/[^/?]+)/);
  return match ? match[1]! : null;
}

function inferMimeType(fileUrl: string, fmt: 'pdf' | 'docx' | 'image'): string {
  if (fmt === 'pdf') return 'application/pdf';
  if (fmt === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  // image: cố infer từ URL extension
  const lower = fileUrl.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}
