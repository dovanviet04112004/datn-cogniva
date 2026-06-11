import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { DOCUMENT_QUEUE } from '../../infra/queue/queue.module';
import { PrismaService } from '../../infra/database/prisma.service';
import { ConceptsService } from '../documents/concepts.service';
import { IngestService } from '../documents/ingest.service';

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

    const chunkRows = await this.prisma.chunk.findMany({
      where: { document_id: documentId },
      select: { id: true },
    });
    const chunkIds = chunkRows.map((r) => r.id);

    if (chunkIds.length === 0) {
      return { chunksProcessed: 0, conceptsExtracted: 0, linksCreated: 0 };
    }

    const stats = await this.concepts.extractConceptsForChunks(chunkIds);

    const backfilled = await this.backfillFlashcards(chunkIds);

    this.logger.log(
      `document concepts extracted documentId=${documentId} ` +
        `chunksProcessed=${stats.chunksProcessed} conceptsExtracted=${stats.conceptsExtracted} ` +
        `linksCreated=${stats.linksCreated} flashcardsBackfilled=${backfilled}`,
    );
    return { ...stats, flashcardsBackfilled: backfilled };
  }

  private async backfillFlashcards(chunkIds: string[]): Promise<number> {
    const linkedChunks = await this.prisma.chunk_concept.findMany({
      where: { chunk_id: { in: chunkIds } },
      select: { chunk_id: true },
      distinct: ['chunk_id'],
    });
    if (linkedChunks.length === 0) return 0;

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
