import { Module } from '@nestjs/common';

import { RecordingPipelineService } from './recording-pipeline.service';
import { FfmpegService } from './media/ffmpeg.service';
import { WhisperService } from './media/whisper.service';
import { SummarizeService } from './summarize.service';

/**
 * RoomsPipelineModule — phần XỬ LÝ recording (ffmpeg/Whisper/summarize/
 * chapters), tách khỏi RoomsModule để JobsModule (worker, không HTTP) import
 * mà không kéo theo controllers + LivekitService. Cần AiModule trong graph
 * (EmbeddingService/LlmService @Global — JobsModule/app.module đã mount).
 */
@Module({
  providers: [RecordingPipelineService, FfmpegService, WhisperService, SummarizeService],
  exports: [RecordingPipelineService],
})
export class RoomsPipelineModule {}
