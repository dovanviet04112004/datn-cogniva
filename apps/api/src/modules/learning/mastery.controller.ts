/**
 * /api/mastery/* — port từ route Next (list + mark + recommendations + decay).
 * Decay là cron endpoint: KHÔNG dùng session mà xác thực qua header
 * `x-cron-secret` (khớp CRON_SECRET env) → đánh @Public() và tự check.
 */
import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { MasteryService } from './mastery.service';
import { markMasterySchema, type MarkMasteryInput } from './dto/mastery.dto';

@ApiTags('mastery')
@Controller('mastery')
export class MasteryController {
  constructor(private readonly mastery: MasteryService) {}

  /** GET /mastery?limit=200&minAttempts=0 — parse y hệt route cũ (cap 500). */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limitRaw?: string,
    @Query('minAttempts') minAttemptsRaw?: string,
  ) {
    const limit = Math.min(Number(limitRaw ?? 200), 500);
    const minAttempts = Math.max(0, Number(minAttemptsRaw ?? 0));
    return { mastery: await this.mastery.listMastery(user.id, limit, minAttempts) };
  }

  @HttpCode(200)
  @Post('mark')
  mark(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(markMasterySchema)) body: MarkMasteryInput,
  ) {
    return this.mastery.markMastery(user.id, body);
  }

  /** GET /mastery/recommendations?limit=10 (max 50). */
  @Get('recommendations')
  async recommendations(@CurrentUser() user: AuthUser, @Query('limit') limitRaw?: string) {
    const limit = Math.min(Number(limitRaw ?? 10), 50);
    return { recommendations: await this.mastery.getRecommendations(user.id, limit) };
  }

  /** POST /mastery/decay — cron-only (x-cron-secret); user thường → 403. */
  @Public()
  @HttpCode(200)
  @Post('decay')
  decay(@Headers('x-cron-secret') secret?: string) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || secret !== cronSecret) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }
    return this.mastery.runDecay();
  }
}
