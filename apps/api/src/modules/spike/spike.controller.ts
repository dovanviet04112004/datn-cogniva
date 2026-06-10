/**
 * ⚠️ SPIKE Wave 0 — XÓA Ở WAVE 1 (thay bằng AuthModule + ChatModule thật).
 * Chứng minh 3 đường găng của plan §7 Wave 0:
 *   1. GET  /api/_spike/whoami : AuthGuard verify (JWT mới + session BA cũ).
 *   2. POST /api/_spike/token  : đổi auth hiện tại → access token JWT ES256.
 *   3. POST /api/_spike/stream : Nest phát đúng AI SDK data-stream protocol
 *      (wire format mà useChat của web/mobile parse) — model mock, không tốn API.
 */
import { Controller, Get, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { streamText, simulateReadableStream } from 'ai';
import { MockLanguageModelV1 } from 'ai/test';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { TokenService } from '../../common/auth/token.service';
import type { AuthUser } from '../../common/auth/session.types';

@ApiTags('_spike')
@Controller('_spike')
export class SpikeController {
  constructor(private readonly tokens: TokenService) {}

  @Get('whoami')
  whoami(@CurrentUser() user: AuthUser) {
    return { user };
  }

  @Post('token')
  async issueToken(@CurrentUser() user: AuthUser) {
    return { accessToken: await this.tokens.signAccessToken(user) };
  }

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
