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
      default:
        this.logger.warn(`cron-v2 job không có handler: ${job.name}`);
        return undefined;
    }
  }
}
