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

export type ParsedDocument = {
  pages: string[];
  totalPages: number;
};

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const data = new Uint8Array(buffer);
  const { text, totalPages } = await extractText(data, { mergePages: false });

  const pages = Array.isArray(text) ? text : [text];

  return { pages, totalPages };
}

export type ChunkInput = {
  content: string;
  page: number;
  chunkIndex: number;
  tokens: number;
};

const TARGET_CHARS = 2000;
const OVERLAP_CHARS = 200;
const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''] as const;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function recursiveSplit(text: string, separators: readonly string[] = SEPARATORS): string[] {
  if (text.length <= TARGET_CHARS) return [text];

  const sep = separators.find((s) => s === '' || text.includes(s)) ?? '';
  const parts = sep === '' ? sliceByLength(text, TARGET_CHARS) : text.split(sep);

  const chunks: string[] = [];
  let buffer = '';
  for (const part of parts) {
    const piece = sep === '' ? part : (buffer ? sep : '') + part;
    if (buffer.length + piece.length <= TARGET_CHARS) {
      buffer += piece;
    } else {
      if (buffer) chunks.push(buffer);
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

function addOverlap(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    const prev = chunks[i - 1] ?? '';
    const tail = prev.slice(-OVERLAP_CHARS);
    return tail + chunk;
  });
}

export function chunkPages(pages: string[]): ChunkInput[] {
  const result: ChunkInput[] = [];
  let globalIndex = 0;

  pages.forEach((pageText, pageIdx) => {
    const cleaned = pageText.trim();
    if (!cleaned) return;

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

  async ingestDocument(documentId: string): Promise<void> {
    try {
      const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
      if (!doc) throw new Error(`Document ${documentId} not found`);

      const buffer = await this.storage.get(doc.storage_key);

      if (doc.mime_type !== 'application/pdf') {
        throw new Error(
          `Unsupported mimeType: ${doc.mime_type}. Phase 1 chỉ hỗ trợ PDF; DOCX/URL/YouTube sẽ thêm sau.`,
        );
      }
      const parsed = await parsePdf(buffer);

      const inputs = chunkPages(parsed.pages);
      if (inputs.length === 0) {
        throw new Error(
          'PDF không có text — có thể là scan ảnh. OCR fallback sẽ thêm ở iteration sau.',
        );
      }

      const embeddings = await this.embedding.embedBatch(inputs.map((c) => c.content));

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

      try {
        await this.documentQueue.add(
          'extract-document-concepts',
          {
            documentId,
            userId: doc.user_id,
            plan: 'FREE' as const,
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
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }
}
