import { Module } from '@nestjs/common';

import { QueueModule } from '../../infra/queue/queue.module';
import { GamificationModule } from '../gamification/gamification.module';
import { ConceptsService } from './concepts.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { IngestService } from './ingest.service';

@Module({
  imports: [QueueModule, GamificationModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, IngestService, ConceptsService],
  exports: [ConceptsService, IngestService],
})
export class DocumentsModule {}
