import { Module } from '@nestjs/common';

import { RecordingPipelineService } from './recording-pipeline.service';
import { FfmpegService } from './media/ffmpeg.service';
import { WhisperService } from './media/whisper.service';
import { SummarizeService } from './summarize.service';

@Module({
  providers: [RecordingPipelineService, FfmpegService, WhisperService, SummarizeService],
  exports: [RecordingPipelineService],
})
export class RoomsPipelineModule {}
