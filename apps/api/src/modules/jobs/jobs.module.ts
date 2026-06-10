import { Module } from '@nestjs/common';

import { AiModule } from '../../infra/ai/ai.module';
import { QueueModule } from '../../infra/queue/queue.module';
import { StorageModule } from '../../infra/storage/storage.module';
import { DocumentsModule } from '../documents/documents.module';
import { CronProcessor } from './cron.processor';
import { DocumentProcessor } from './document.processor';
import { HealthMonitorJob } from './handlers/health-monitor.job';
import { ReconcileLeaderboardJob } from './handlers/reconcile-leaderboard.job';

/**
 * JobsModule — CHỈ import vào WorkerModule (worker.ts). Đừng đưa vào
 * AppModule: @Processor sẽ mở worker BullMQ ngay trong process HTTP.
 *
 * AiModule + StorageModule import tường minh ở đây vì WorkerModule KHÔNG
 * mount chúng như app.module — @Global chỉ có tác dụng khi module nằm trong
 * graph; DocumentsModule (ConceptsService/IngestService) cần cả hai.
 */
@Module({
  imports: [QueueModule, AiModule, StorageModule, DocumentsModule],
  providers: [CronProcessor, DocumentProcessor, HealthMonitorJob, ReconcileLeaderboardJob],
})
export class JobsModule {}
