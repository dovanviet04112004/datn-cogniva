import { Module } from '@nestjs/common';

import { QueueModule } from '../../infra/queue/queue.module';
import { CronProcessor } from './cron.processor';
import { HealthMonitorJob } from './handlers/health-monitor.job';
import { ReconcileLeaderboardJob } from './handlers/reconcile-leaderboard.job';

/**
 * JobsModule — CHỈ import vào WorkerModule (worker.ts). Đừng đưa vào
 * AppModule: @Processor sẽ mở worker BullMQ ngay trong process HTTP.
 */
@Module({
  imports: [QueueModule],
  providers: [CronProcessor, HealthMonitorJob, ReconcileLeaderboardJob],
})
export class JobsModule {}
