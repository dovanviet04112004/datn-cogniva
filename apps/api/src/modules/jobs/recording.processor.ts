/**
 * RecordingProcessor — worker BullMQ queue `recording` (GIỮ TÊN queue cũ:
 * producer là webhook LiveKit ở apps/web tới W6, payload RecordingJob giữ
 * nguyên shape). Concurrency 2 y worker cũ (apps/web/src/worker/index.ts);
 * retry attempts=2 + backoff exponential nằm ở job options phía producer.
 * Idempotent nhờ early-return PROCESSED + checkpoint transcript (pipeline).
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { RECORDING_QUEUE } from '../../infra/queue/queue.module';
import {
  RecordingPipelineService,
  type RecordingJob,
} from '../rooms/recording-pipeline.service';

@Processor(RECORDING_QUEUE, { concurrency: 2 })
export class RecordingProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordingProcessor.name);

  constructor(private readonly pipeline: RecordingPipelineService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'process':
        return this.pipeline.processRecording(job.data as RecordingJob);
      default:
        this.logger.warn(`recording job không có handler: ${job.name}`);
        return undefined;
    }
  }
}
