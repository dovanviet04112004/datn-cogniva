import { Module } from '@nestjs/common';

import { QueueModule } from '../../infra/queue/queue.module';
import { RecordingPipelineService } from '../channels/recording-pipeline.service';
import { PaymentsModule } from '../payments/payments.module';
import { LivekitWebhookService } from './livekit-webhook.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [QueueModule, PaymentsModule],
  controllers: [WebhooksController],
  providers: [LivekitWebhookService, RecordingPipelineService],
})
export class WebhooksModule {}
