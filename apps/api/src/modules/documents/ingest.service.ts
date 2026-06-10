/**
 * IngestService — pipeline parse PDF → chunk → embed → save, port từ
 * apps/web/src/lib/ingest/{parse,chunk,pipeline}.ts. Thuật toán chunker +
 * thông điệp lỗi + flow enqueue/fallback GIỮ NGUYÊN để golden-diff khớp.
 *
 * chunk.embedding là Unsupported("vector") trong Prisma → insert qua
 * $executeRaw `::vector` (xem prisma/NOTES.md), batch nhiều row 1 query
 * như Drizzle insert cũ (tránh N+1).
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { extractText } from 'unpdf';

import { EmbeddingService } from '../../infra/ai/embedding.service';
import { DOCUMENT_QUEUE } from '../../infra/queue/queue.module';
import { PrismaService } from '../../infra/database/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { ConceptsService } from './concepts.service';

/* ── Parse (port lib/ingest/parse.ts) ────────────────────────────────────── */

export type ParsedDocument = {
  /** Text từng trang (1-indexed: pages[0] là page 1). */
  pages: string[];
  totalPages: number;
};

/** Trích text từ PDF buffer qua unpdf (PDF.js compiled cho Node, có dist CJS). */
async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // unpdf cần Uint8Array, không nhận Buffer trực tiếp ở một số phiên bản
  const data = new Uint8Array(buffer);
  const { text, totalPages } = await extractText(data, { mergePages: false });

  // unpdf trả `text` có thể là string (mergePages=true) hoặc string[]
  // (mergePages=false). Force về string[] để xử lý đồng nhất.
  const pages = Array.isArray(text) ? text : [text];

  return { pages, totalPages };
}

/* ── Chunker (port NGUYÊN thuật toán lib/ingest/chunk.ts) ────────────────── */

export type ChunkInput = {
  content: string;
  /** Trang gốc (1-indexed như PDF reader). */
  page: number;
  /** Vị trí trong tài liệu (0-based). */
  chunkIndex: number;
  /** Ước lượng số token (~4 chars/token). */
  tokens: number;
};

const TARGET_CHARS = 2000;
const OVERLAP_CHARS = 200;
const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''] as const;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Recursive character splitter: cắt theo ranh giới ngữ nghĩa ưu tiên
 * (\n\n → \n → ". " → " " → ký tự đơn), gom part nhỏ gần TARGET_CHARS.
 */
function recursiveSplit(text: string, separators: readonly string[] = SEPARATORS): string[] {
  if (text.length <= TARGET_CHARS) return [text];

  const sep = separators.find((s) => s === '' || text.includes(s)) ?? '';
  // sep === '' tương đương cắt cứng theo độ dài (fallback cuối cùng)
  const parts = sep === '' ? sliceByLength(text, TARGET_CHARS) : text.split(sep);

  const chunks: string[] = [];
  let buffer = '';
  for (const part of parts) {
    const piece = sep === '' ? part : (buffer ? sep : '') + part;
    if (buffer.length + piece.length <= TARGET_CHARS) {
      buffer += piece;
    } else {
      if (buffer) chunks.push(buffer);
      // 1 part đơn lẻ vẫn quá dài → split tiếp với separators ít cấu trúc hơn
      if (part.length > TARGET_CHARS) {
        chunks.push(...recursiveSplit(part, separators.slice(1)));
        buffer = '';
      } else {
        buffer = part;
      }
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function sliceByLength(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** Overlap 200 ký tự giữa chunks liên tiếp — phòng câu trả lời nằm giữa biên. */
function addOverlap(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    const prev = chunks[i - 1] ?? '';
    const tail = prev.slice(-OVERLAP_CHARS);
    return tail + chunk;
  });
}

/** Cắt nguyên tài liệu theo từng trang, gắn metadata page + chunkIndex. */
export function chunkPages(pages: string[]): ChunkInput[] {
  const result: ChunkInput[] = [];
  let globalIndex = 0;

  pages.forEach((pageText, pageIdx) => {
    const cleaned = pageText.trim();
    if (!cleaned) return; // bỏ qua trang trắng

    const split = recursiveSplit(cleaned);
    const withOverlap = addOverlap(split);

    for (const chunk of withOverlap) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      result.push({
        content: trimmed,
        page: pageIdx + 1,
        chunkIndex: globalIndex++,
        tokens: estimateTokens(trimmed),
      });
    }
  });

  return result;
}

/* ── Pipeline orchestrator (port lib/ingest/pipeline.ts) ─────────────────── */

/** Batch size insert chunk — mỗi row 6 param, giữ xa limit 32k param của PG. */
const INSERT_BATCH = 100;

@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly embedding: EmbeddingService,
    private readonly concepts: ConceptsService,
    @InjectQueue(DOCUMENT_QUEUE) private readonly documentQueue: Queue,
  ) {}

  /**
   * Chạy ingest end-to-end cho 1 document đã có record (status PROCESSING).
   * Bất kỳ exception → đặt status=FAILED rồi rethrow để caller xử lý (route
   * upload trả 207).
   */
  async ingestDocument(documentId: string): Promise<void> {
    try {
      // ── 1. Load document record ─────────────────────────
      const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
      if (!doc) throw new Error(`Document ${documentId} not found`);

      // ── 2. Tải file từ storage ──────────────────────────
      const buffer = await this.storage.get(doc.storage_key);

      // ── 3. Parse PDF ────────────────────────────────────
      if (doc.mime_type !== 'application/pdf') {
        throw new Error(
          `Unsupported mimeType: ${doc.mime_type}. Phase 1 chỉ hỗ trợ PDF; DOCX/URL/YouTube sẽ thêm sau.`,
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
      const embeddings = await this.embedding.embedBatch(inputs.map((c) => c.content));

      // ── 6. Insert chunks (multi-row, vector qua raw SQL) ─
      for (let i = 0; i < inputs.length; i += INSERT_BATCH) {
        const slice = inputs.slice(i, i + INSERT_BATCH);
        const rows = slice.map((input, j) => {
          const vectorLiteral = `[${(embeddings[i + j] ?? []).join(',')}]`;
          const metadata = JSON.stringify({ chunkIndex: input.chunkIndex, page: input.page });
          return Prisma.sql`(${randomUUID()}, ${documentId}, ${input.content}, ${vectorLiteral}::vector, ${metadata}::jsonb, ${input.tokens})`;
        });
        await this.prisma.$executeRaw(Prisma.sql`
          INSERT INTO chunk (id, document_id, content, embedding, metadata, tokens)
          VALUES ${Prisma.join(rows)};
        `);
      }

      // ── 7. Mark READY + cập nhật metadata ───────────────
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'READY',
          metadata: {
            ...((doc.metadata as Record<string, unknown>) ?? {}),
            pageCount: parsed.totalPages,
          },
        },
      });

      // ── 8. Enqueue BullMQ job extract-document-concepts ──
      // jobId=documentId dedup; retry 3 lần exponential nếu LLM/Voyage fail.
      try {
        await this.documentQueue.add(
          'extract-document-concepts',
          {
            documentId,
            userId: doc.user_id,
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
        // Enqueue lỗi (vd Redis chết lúc upload) → fallback extract NGAY
        // (đồng bộ, best-effort) để document không kẹt READY mà không có atom.
        // Lỗi extract cũng không kéo cả ingest fail (chunks đã READY).
        console.warn(
          '[ingest] enqueue concept extraction lỗi → chạy inline fallback:',
          (err as Error).message,
        );
        try {
          await this.concepts.extractConceptsForDocument(documentId);
        } catch (inlineErr) {
          console.warn(
            '[ingest] inline concept extraction cũng lỗi:',
            (inlineErr as Error).message,
          );
        }
      }
    } catch (error) {
      // Đánh dấu FAILED rồi rethrow để caller log + xử lý
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }
}
