import { Module } from '@nestjs/common';

import { AiModule } from '../../infra/ai/ai.module';
import { QueueModule } from '../../infra/queue/queue.module';
import { StorageModule } from '../../infra/storage/storage.module';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoomsPipelineModule } from '../rooms/rooms-pipeline.module';
import { CronProcessor } from './cron.processor';
import { DocumentProcessor } from './document.processor';
import { RecordingProcessor } from './recording.processor';
import { FlashcardDueReminderJob } from './handlers/flashcard-due-reminder.job';
import { HealthMonitorJob } from './handlers/health-monitor.job';
import { LibraryProDowngradeJob } from './handlers/library-pro-downgrade.job';
import { LibraryProExpiryWarnJob } from './handlers/library-pro-expiry-warn.job';
import { LibrarySavedSearchNotifyJob } from './handlers/library-saved-search-notify.job';
import { ProcessGdprDeletionJob } from './handlers/process-gdpr-deletion.job';
import { ReconcileLeaderboardJob } from './handlers/reconcile-leaderboard.job';
import { ThreadArchiveStaleJob } from './handlers/thread-archive-stale.job';
import { TutoringAutoCompleteJob } from './handlers/tutoring-auto-complete.job';
import { TutoringRecurringRolloutJob } from './handlers/tutoring-recurring-rollout.job';
import { TutoringRefreshEmbeddingsJob } from './handlers/tutoring-refresh-embeddings.job';

/**
 * JobsModule — CHỈ import vào WorkerModule (worker.ts). Đừng đưa vào
 * AppModule: @Processor sẽ mở worker BullMQ ngay trong process HTTP.
 *
 * AiModule + StorageModule import tường minh ở đây vì WorkerModule KHÔNG
 * mount chúng như app.module — @Global chỉ có tác dụng khi module nằm trong
 * graph; DocumentsModule (ConceptsService/IngestService) cần cả hai.
 * NotificationsModule → getPushTokens cho flashcard-due-reminder +
 * library-pro-expiry-warn + library-saved-search-notify.
 * RoomsPipelineModule (KHÔNG phải RoomsModule — tránh kéo controllers/LiveKit
 * vào worker) → RecordingPipelineService cho RecordingProcessor.
 */
@Module({
  imports: [
    QueueModule,
    AiModule,
    StorageModule,
    DocumentsModule,
    NotificationsModule,
    RoomsPipelineModule,
  ],
  providers: [
    CronProcessor,
    DocumentProcessor,
    RecordingProcessor,
    HealthMonitorJob,
    ReconcileLeaderboardJob,
    ThreadArchiveStaleJob,
    FlashcardDueReminderJob,
    LibraryProDowngradeJob,
    LibraryProExpiryWarnJob,
    LibrarySavedSearchNotifyJob,
    TutoringAutoCompleteJob,
    TutoringRecurringRolloutJob,
    ProcessGdprDeletionJob,
    TutoringRefreshEmbeddingsJob,
  ],
})
export class JobsModule {}
