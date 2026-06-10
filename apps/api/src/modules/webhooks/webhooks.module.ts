/**
 * WebhooksModule — Wave 6: webhook public VNPay/MoMo/LiveKit.
 *
 * RecordingPipelineService (inline pipeline cho channel recording) provide
 * TẠI ĐÂY thay vì import ChannelsVoiceModule: module đó không export service
 * này, mà deps của nó (Prisma/Llm/Embedding) đều @Global nên instance riêng
 * (stateless) là vô hại — không phải đụng file ngoài phạm vi webhooks.
 */
import { Module } from '@nestjs/common';

import { QueueModule } from '../../infra/queue/queue.module';
import { RecordingPipelineService } from '../channels/recording-pipeline.service';
import { PaymentsModule } from '../payments/payments.module';
import { LivekitWebhookService } from './livekit-webhook.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  // QueueModule → @InjectQueue(RECORDING_QUEUE); PaymentsModule → verifyVnpaySignature.
  imports: [QueueModule, PaymentsModule],
  controllers: [WebhooksController],
  providers: [LivekitWebhookService, RecordingPipelineService],
})
export class WebhooksModule {}
