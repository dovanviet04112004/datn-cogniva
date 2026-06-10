/**
 * CronProcessor — worker BullMQ queue `cron-v2`, dispatch theo job.name.
 * Concurrency 1 (serial) + attempts mặc định 1 (KHÔNG retry) — đúng semantics
 * worker cũ: cron lỡ 1 lần thì lần schedule sau chạy lại.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { CRON_QUEUE } from '../../infra/queue/queue.module';
import { FlashcardDueReminderJob } from './handlers/flashcard-due-reminder.job';
import { HealthMonitorJob } from './handlers/health-monitor.job';
import { LibraryProDowngradeJob } from './handlers/library-pro-downgrade.job';
import { LibraryProExpiryWarnJob } from './handlers/library-pro-expiry-warn.job';
import { LibrarySavedSearchNotifyJob } from './handlers/library-saved-search-notify.job';
import { ReconcileLeaderboardJob } from './handlers/reconcile-leaderboard.job';
import { ThreadArchiveStaleJob } from './handlers/thread-archive-stale.job';

@Processor(CRON_QUEUE, { concurrency: 1 })
export class CronProcessor extends WorkerHost {
  private readonly logger = new Logger(CronProcessor.name);

  constructor(
    private readonly healthMonitor: HealthMonitorJob,
    private readonly reconcileLeaderboard: ReconcileLeaderboardJob,
    private readonly threadArchiveStale: ThreadArchiveStaleJob,
    private readonly flashcardDueReminder: FlashcardDueReminderJob,
    private readonly libraryProDowngrade: LibraryProDowngradeJob,
    private readonly libraryProExpiryWarn: LibraryProExpiryWarnJob,
    private readonly librarySavedSearchNotify: LibrarySavedSearchNotifyJob,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'health-monitor':
        return this.healthMonitor.run();
      case 'reconcile-leaderboard':
        return this.reconcileLeaderboard.run();
      case 'thread-archive-stale':
        return this.threadArchiveStale.run();
      case 'flashcard-due-reminder':
        return this.flashcardDueReminder.run();
      case 'library-pro-downgrade':
        return this.libraryProDowngrade.run();
      case 'library-pro-expiry-warn':
        return this.libraryProExpiryWarn.run();
      case 'library-saved-search-notify':
        return this.librarySavedSearchNotify.run();
      default:
        this.logger.warn(`cron-v2 job không có handler: ${job.name}`);
        return undefined;
    }
  }
}
