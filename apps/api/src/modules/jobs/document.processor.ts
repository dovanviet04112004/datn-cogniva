/**
 * DocumentProcessor — worker BullMQ queue `document`, port từ
 * apps/web/src/jobs/extract-document-concepts.ts. Concurrency 2 (y worker cũ
 * — tránh Voyage rate limit free tier); retry policy nằm ở job options khi
 * enqueue (attempts 3, backoff exponential — xem IngestService).
 *
 * Idempotent: pivot chunk_concept ON CONFLICT DO NOTHING + backfill chỉ
 * UPDATE flashcard có concept_id NULL → whole-job retry không gây dup.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { DOCUMENT_QUEUE } from '../../infra/queue/queue.module';
import { PrismaService } from '../../infra/database/prisma.service';
import { ConceptsService } from '../documents/concepts.service';
import { IngestService } from '../documents/ingest.service';

/**
 * Payload job `extract-document-concepts` — NGUỒN CHUẨN ở
 * apps/web/src/queue/jobs.ts (DocumentJob, web còn produce tới cutover) —
 * đổi thì sửa cả 2. `plan` chưa dùng ở api (router cost-guardrail là của web).
 */
type DocumentJobData = {
  documentId: string;
  userId: string;
  plan: 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';
};

@Processor(DOCUMENT_QUEUE, { concurrency: 2 })
export class DocumentProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
    private readonly ingest: IngestService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'extract-document-concepts':
        return this.extractDocumentConcepts(job.data as DocumentJobData);
      // Admin reingest (AdminDocumentsService): pipeline chạy ở worker thay
      // fire-and-forget in-process của web — HTTP process không ăn CPU parse
      // PDF. attempts=1 (producer không set retry) y semantics cũ: pipeline
      // tự set status FAILED khi lỗi, UI poll.
      case 'ingest-document':
        await this.ingest.ingestDocument((job.data as { documentId: string }).documentId);
        return { ok: true };
      default:
        this.logger.warn(`document job không có handler: ${job.name}`);
        return undefined;
    }
  }

  private async extractDocumentConcepts(data: DocumentJobData) {
    const { documentId } = data;

    // Step 1: verify document tồn tại + ready (anti race với delete)
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, status: true },
    });

    if (!doc) {
      this.logger.log(`document not found, skip extract documentId=${documentId}`);
      return { skipped: 'document-not-found' };
    }
    if (doc.status !== 'READY') {
      this.logger.log(
        `document not ready, skip extract documentId=${documentId} status=${doc.status}`,
      );
      return { skipped: 'document-not-ready' };
    }

    // Step 2: load chunk ids
    const chunkRows = await this.prisma.chunk.findMany({
      where: { document_id: documentId },
      select: { id: true },
    });
    const chunkIds = chunkRows.map((r) => r.id);

    if (chunkIds.length === 0) {
      return { chunksProcessed: 0, conceptsExtracted: 0, linksCreated: 0 };
    }

    // Step 3: extract (LLM + embed + dedup + INSERT pivot)
    const stats = await this.concepts.extractConceptsForChunks(chunkIds);

    // Step 4: backfill flashcard.concept_id cho card sinh TRƯỚC khi extract
    // xong (race window: user gen flashcard ngay sau upload → card có
    // sourceChunkId nhưng conceptId NULL vì pivot chưa có).
    const backfilled = await this.backfillFlashcards(chunkIds);

    this.logger.log(
      `document concepts extracted documentId=${documentId} ` +
        `chunksProcessed=${stats.chunksProcessed} conceptsExtracted=${stats.conceptsExtracted} ` +
        `linksCreated=${stats.linksCreated} flashcardsBackfilled=${backfilled}`,
    );
    return { ...stats, flashcardsBackfilled: backfilled };
  }

  private async backfillFlashcards(chunkIds: string[]): Promise<number> {
    // Lấy chunk_ids có concept link
    const linkedChunks = await this.prisma.chunk_concept.findMany({
      where: { chunk_id: { in: chunkIds } },
      select: { chunk_id: true },
      distinct: ['chunk_id'],
    });
    if (linkedChunks.length === 0) return 0;

    // Build map chunk → concept đầu tiên gặp (y semantics lib cũ — không order)
    const links = await this.prisma.chunk_concept.findMany({
      where: { chunk_id: { in: linkedChunks.map((c) => c.chunk_id) } },
      select: { chunk_id: true, concept_id: true, strength: true },
    });
    const chunkToConcept = new Map<string, string>();
    for (const l of links) {
      if (!chunkToConcept.has(l.chunk_id)) {
        chunkToConcept.set(l.chunk_id, l.concept_id);
      }
    }

    // UPDATE từng chunk (~50-200 — chấp nhận N query cho rõ ràng, y lib cũ)
    let count = 0;
    for (const [chId, conceptId] of chunkToConcept) {
      const updated = await this.prisma.flashcard.updateMany({
        where: { source_chunk_id: chId, concept_id: null },
        data: { concept_id: conceptId },
      });
      count += updated.count;
    }
    return count;
  }
}
