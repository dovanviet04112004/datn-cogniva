import { Module } from '@nestjs/common';

import { QueueModule } from '../../infra/queue/queue.module';
import { GamificationModule } from '../gamification/gamification.module';
import { ConceptsService } from './concepts.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { IngestService } from './ingest.service';

/**
 * DocumentsModule — documents CRUD + ingest pipeline + concept extraction
 * (Wave 3 core học tập). QueueModule: enqueue extract-document-concepts lên
 * queue `document`; GamificationModule: XP cho upload.
 */
@Module({
  imports: [QueueModule, GamificationModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, IngestService, ConceptsService],
  // ConceptsService exported cho DocumentProcessor (jobs) dùng lại extract.
  exports: [ConceptsService],
})
export class DocumentsModule {}
