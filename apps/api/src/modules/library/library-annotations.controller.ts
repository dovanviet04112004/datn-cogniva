/**
 * /api/library/docs/:id/annotations + /api/library/annotations/:id[/vote] —
 * port từ route Next (xem library-annotations.service.ts). Mọi POST route cũ
 * trả 200 → @HttpCode(200). GET list là route public (anonymous thấy note
 * public) — resolve viewer tùy chọn qua OptionalAuthService.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { OptionalAuthService } from '../../common/auth/optional-auth.service';
import type { AuthUser } from '../../common/auth/session.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { LibraryAnnotationsService } from './library-annotations.service';

@ApiTags('library')
@Controller('library')
export class LibraryAnnotationsController {
  constructor(
    private readonly annotations: LibraryAnnotationsService,
    private readonly optionalAuth: OptionalAuthService,
  ) {}

  /** GET docs/:id/annotations — list public + own (own cần login, không bắt buộc). */
  @Public()
  @Get('docs/:id/annotations')
  async list(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.optionalAuth.resolveUserId(req);
    return this.annotations.listForDoc(id, userId);
  }

  /** POST docs/:id/annotations — tạo note (service check doc 404/403 TRƯỚC parse body). */
  @HttpCode(200)
  @Post('docs/:id/annotations')
  create(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.annotations.createAnnotation(user.id, id, raw);
  }

  /** DELETE annotations/:id — author xoá note. */
  @Delete('annotations/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.annotations.deleteAnnotation(user.id, id);
  }

  /** POST annotations/:id/vote — toggle helpful vote. */
  @HttpCode(200)
  @Post('annotations/:id/vote')
  vote(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.annotations.vote(user.id, id);
  }
}
