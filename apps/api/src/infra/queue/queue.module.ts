import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import { redisOptionsFromUrl } from '@cogniva/server-core/redis';

export const CRON_QUEUE = 'cron-v2';

export const DOCUMENT_QUEUE = 'document';

export const RECORDING_QUEUE = 'recording';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const parsed = redisOptionsFromUrl(config.getOrThrow<string>('REDIS_URL'));
        return {
          connection:
            typeof parsed === 'string'
              ? new IORedis(parsed, { maxRetriesPerRequest: null })
              : new IORedis({ ...parsed, maxRetriesPerRequest: null }),
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: CRON_QUEUE },
      { name: DOCUMENT_QUEUE },
      { name: RECORDING_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
