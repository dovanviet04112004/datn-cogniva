import { Module } from '@nestjs/common';

import { LivekitModule } from '../../infra/livekit/livekit.module';
import { GroupsModule } from '../groups/groups.module';
import { ChannelsVoiceController } from './channels-voice.controller';
import { RecordingPipelineService } from './recording-pipeline.service';
import { VoiceRecordingsService } from './voice-recordings.service';
import { VoiceService } from './voice.service';

@Module({
  imports: [LivekitModule, GroupsModule],
  controllers: [ChannelsVoiceController],
  providers: [VoiceService, VoiceRecordingsService, RecordingPipelineService],
})
export class ChannelsVoiceModule {}
