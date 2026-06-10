/**
 * /api/library/* — nhóm ENRICH/AI (endorse, remix, atoms, translate, podcast,
 * admin recompute-quality), port từ apps/web/src/app/api/library/** tương ứng.
 *
 * GET endorse + GET atoms là route cũ KHÔNG bắt session (overlay per-user khi
 * login) → @Public() + OptionalAuthService. POST route cũ trả 200.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { OptionalAuthService } from '../../common/auth/optional-auth.service';
import type { AuthUser } from '../../common/auth/session.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { LibraryEnrichService } from './library-enrich.service';

@ApiTags('library')
@Controller('library')
export class LibraryEnrichController {
  constructor(
    private readonly enrich: LibraryEnrichService,
    private readonly optionalAuth: OptionalAuthService,
  ) {}

  /** GET docs/:id/endorse — list endorsements public + viewer eligibility. */
  @Public()
  @Get('docs/:id/endorse')
  async listEndorsements(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.optionalAuth.resolveUserId(req);
    return this.enrich.listEndorsements(id, userId);
  }

  /** POST docs/:id/endorse — verified tutor endorse (service check 403 TRƯỚC parse body). */
  @HttpCode(200)
  @Post('docs/:id/endorse')
  endorse(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.enrich.endorse(user.id, id, raw);
  }

  /** DELETE docs/:id/endorse — tutor revoke endorsement. */
  @Delete('docs/:id/endorse')
  revokeEndorsement(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.enrich.revokeEndorsement(user.id, id);
  }

  /** POST remix — doc tổng hợp từ 2-5 nguồn (karma + atoms + quality async). */
  @HttpCode(200)
  @Post('remix')
  remix(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.enrich.remix(user.id, raw);
  }

  /** GET docs/:id/atoms — atom map + mastery overlay nếu login. */
  @Public()
  @Get('docs/:id/atoms')
  async listAtoms(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.optionalAuth.resolveUserId(req);
    return this.enrich.listAtoms(id, userId);
  }

  /** POST docs/:id/atoms — trigger atom extraction (owner-only, idempotent). */
  @HttpCode(200)
  @Post('docs/:id/atoms')
  extractAtoms(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.enrich.extractAtoms(user.id, id);
  }

  /** POST docs/:id/translate — dịch text payload vi↔en qua LLM. */
  @HttpCode(200)
  @Post('docs/:id/translate')
  translate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.enrich.translate(user.id, id, raw);
  }

  /** POST docs/:id/podcast — generate script 2-host (browser Web Speech TTS $0). */
  @HttpCode(200)
  @Post('docs/:id/podcast')
  podcast(@Param('id') id: string) {
    return this.enrich.podcastScript(id);
  }

  /* POST admin/recompute-quality KHÔNG port — 0 caller (admin page TODO chưa
     tồn tại); QualityScoreService giữ nguyên, Wave 7 admin cần thì expose lại. */
}
