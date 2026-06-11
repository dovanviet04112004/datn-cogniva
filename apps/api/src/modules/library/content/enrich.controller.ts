import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { OptionalAuthService } from '../../../common/auth/optional-auth.service';
import type { AuthUser } from '../../../common/auth/session.types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { LibraryEnrichService } from './enrich.service';

@ApiTags('library')
@Controller('library')
export class LibraryEnrichController {
  constructor(
    private readonly enrich: LibraryEnrichService,
    private readonly optionalAuth: OptionalAuthService,
  ) {}

  @Public()
  @Get('docs/:id/endorse')
  async listEndorsements(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.optionalAuth.resolveUserId(req);
    return this.enrich.listEndorsements(id, userId);
  }

  @HttpCode(200)
  @Post('docs/:id/endorse')
  endorse(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.enrich.endorse(user.id, id, raw);
  }

  @Delete('docs/:id/endorse')
  revokeEndorsement(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.enrich.revokeEndorsement(user.id, id);
  }

  @HttpCode(200)
  @Post('remix')
  remix(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.enrich.remix(user.id, raw);
  }

  @Public()
  @Get('docs/:id/atoms')
  async listAtoms(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.optionalAuth.resolveUserId(req);
    return this.enrich.listAtoms(id, userId);
  }

  @HttpCode(200)
  @Post('docs/:id/atoms')
  extractAtoms(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.enrich.extractAtoms(user.id, id);
  }

  @HttpCode(200)
  @Post('docs/:id/translate')
  translate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.enrich.translate(user.id, id, raw);
  }

  @HttpCode(200)
  @Post('docs/:id/podcast')
  podcast(@Param('id') id: string) {
    return this.enrich.podcastScript(id);
  }
}
