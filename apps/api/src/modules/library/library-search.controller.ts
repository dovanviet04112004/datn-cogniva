/**
 * /api/library/{search/*,voice-search,goal} — port từ route Next:
 *   POST search/cross-doc  — Pillar #2 cross-doc semantic search
 *   POST search/reverse    — Pillar #4 reverse search (đề khó → docs)
 *   POST voice-search      — Phase 5 audio → Whisper → search
 *   POST goal              — Pillar #1 goal-driven discovery (LLM plan)
 * Tất cả cần session; route cũ trả 200 → @HttpCode(200). Body safeParse tại
 * đây để giữ shape lỗi cũ {error:'Invalid body', details: flatten}.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { GoalPlannerService } from './goal-planner.service';
import { ReverseSearchService } from './reverse-search.service';
import { VoiceSearchService } from './voice-search.service';
import type { Plan } from './library-llm.service';

const REVERSE_BODY = z
  .object({
    problemText: z.string().min(5).max(3000).optional(),
    problemImageBase64: z.string().optional(),
    problemImageMimeType: z.string().optional(),
    hint: z
      .object({
        subjectSlug: z.string().optional(),
        level: z.string().optional(),
        grade: z.number().int().min(1).max(12).optional(),
      })
      .optional(),
  })
  .refine((d) => d.problemText || d.problemImageBase64, {
    message: 'Cần problemText hoặc problemImageBase64',
  });

const GOAL_BODY = z.object({
  userMessage: z.string().min(5).max(500),
});

@ApiTags('library')
@Controller('library')
export class LibrarySearchController {
  constructor(
    private readonly reverse: ReverseSearchService,
    private readonly voice: VoiceSearchService,
    private readonly goalPlanner: GoalPlannerService,
  ) {}

  /* POST search/cross-doc KHÔNG port — 0 caller (feature thử nghiệm Phase 3
     không có UI). CrossDocSearchService vẫn sống cho voice-search. */

  /** POST /library/search/reverse — analysis + 3 cluster doc (theory/exercise/exam). */
  @HttpCode(200)
  @Post('search/reverse')
  async reverseSearch(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const parsed = REVERSE_BODY.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }

    const plan = (user.plan ?? 'FREE') as Plan;

    try {
      return await this.reverse.reverseSearch({ ...parsed.data, userId: user.id, plan });
    } catch (err) {
      console.error('[reverse-search]', err);
      throw new HttpException(
        { error: 'Search failed', message: (err as Error).message },
        500,
      );
    }
  }

  /**
   * POST /library/voice-search — multipart field `audio` (max 25MB, check thủ
   * công trong service để giữ message 413 cũ — KHÔNG set multer limits vì
   * route cũ buffer toàn bộ formData rồi mới check size).
   */
  @HttpCode(200)
  @Post('voice-search')
  @UseInterceptors(FileInterceptor('audio'))
  voiceSearch(
    @CurrentUser() user: AuthUser,
    @UploadedFile() audio: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.voice.voiceSearch(user.id, audio, body ?? {}, req.headers['content-type'] ?? '');
  }

  /** POST /library/goal — parsed goal + weekly study plan + docs cho mỗi tuần. */
  @HttpCode(200)
  @Post('goal')
  async goal(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const parsed = GOAL_BODY.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }

    const plan = (user.plan ?? 'FREE') as Plan;

    try {
      const goal = await this.goalPlanner.parseGoal({
        userMessage: parsed.data.userMessage,
        userId: user.id,
        plan,
      });
      return await this.goalPlanner.buildStudyPlan(goal);
    } catch (err) {
      console.error('[library.goal]', err);
      throw new HttpException(
        { error: 'Goal planning failed', message: (err as Error).message },
        500,
      );
    }
  }
}
