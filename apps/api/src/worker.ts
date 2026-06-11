import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { validateEnv } from './infra/config/env.schema';
import { PrismaModule } from './infra/database/prisma.module';
import { QueueModule, CRON_QUEUE } from './infra/queue/queue.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { CRON_JOBS_V2 } from './modules/jobs/cron-jobs';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    QueueModule,
    JobsModule,
  ],
})
class WorkerModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const queue = app.get<Queue>(getQueueToken(CRON_QUEUE));
  for (const c of CRON_JOBS_V2) {
    await queue.upsertJobScheduler(c.id, { pattern: c.pattern, tz: 'UTC' }, { name: c.id });
  }
  console.log(`[worker] ready — ${CRON_JOBS_V2.length} cron trên queue ${CRON_QUEUE}`);
}

void bootstrap();
