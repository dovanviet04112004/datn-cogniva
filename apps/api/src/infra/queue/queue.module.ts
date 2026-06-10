/**
 * QueueModule — BullMQ root cho worker NestJS (plan QĐ-5).
 *
 * Queue `cron-v2`: cron jobs đã PORT từ worker cũ của apps/web. Tách queue
 * riêng (không dùng chung `cron`) vì 2 worker chạy song song trên 1 queue mà
 * mỗi bên chỉ có 1 phần handler → job rơi nhầm bên kia sẽ fail. Job nào port
 * xong thì GỠ khỏi CRON_JOBS của web (đã làm) — không double-run.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';

export const CRON_QUEUE = 'cron-v2';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        // BullMQ tự .duplicate() connection cho từng queue/worker khi cần.
        connection: new IORedis(config.getOrThrow<string>('REDIS_URL'), {
          maxRetriesPerRequest: null,
        }),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: CRON_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
