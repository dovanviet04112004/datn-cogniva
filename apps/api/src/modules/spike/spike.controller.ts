/**
 * ⚠️ SPIKE — XÓA KHI ChatModule PORT XONG (Wave 7).
 * Chứng minh Nest phát đúng AI SDK data-stream protocol (wire format mà
 * useChat của web/mobile parse) — model mock, không tốn API.
 */
import { Controller, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { streamText, simulateReadableStream } from 'ai';
import { MockLanguageModelV1 } from 'ai/test';

import { Public } from '../../common/decorators/public.decorator';

@ApiTags('_spike')
@Controller('_spike')
export class SpikeController {
  @Public()
  @Post('stream')
  async stream(@Res() res: Response) {
    const result = streamText({
      model: new MockLanguageModelV1({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-delta', textDelta: 'Xin ' },
              { type: 'text-delta', textDelta: 'chào ' },
              { type: 'text-delta', textDelta: 'từ NestJS!' },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { promptTokens: 3, completionTokens: 5 },
              },
            ],
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
      }),
      prompt: 'spike',
    });
    result.pipeDataStreamToResponse(res);
  }
}
