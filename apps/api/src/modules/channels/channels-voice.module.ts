import { Module } from '@nestjs/common';

import { LivekitModule } from '../../infra/livekit/livekit.module';
import { GroupsModule } from '../groups/groups.module';
import { ChannelsVoiceController } from './channels-voice.controller';
import { RecordingPipelineService } from './recording-pipeline.service';
import { VoiceRecordingsService } from './voice-recordings.service';
import { VoiceService } from './voice.service';

/**
 * ChannelsVoiceModule — voice/stage/record/collab-token của study group
 * channel. TÁCH RIÊNG khỏi ChannelsModule (messages/forum/threads) — 2 module
 * cùng mount path 'channels' là hợp lệ trong Nest.
 *
 * Import LivekitModule tường minh: module @Global vẫn phải được import ÍT
 * NHẤT 1 lần trong graph mới register provider — root app.module chưa có nó.
 */
@Module({
  imports: [LivekitModule, GroupsModule],
  controllers: [ChannelsVoiceController],
  providers: [VoiceService, VoiceRecordingsService, RecordingPipelineService],
})
export class ChannelsVoiceModule {}
