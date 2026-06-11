import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { OptionalAuthService } from '../../../common/auth/optional-auth.service';
import type { AuthUser } from '../../../common/auth/session.types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { LibraryAnnotationsService } from './annotations.service';

@ApiTags('library')
@Controller('library')
export class LibraryAnnotationsController {
  constructor(
    private readonly annotations: LibraryAnnotationsService,
    private readonly optionalAuth: OptionalAuthService,
  ) {}

  @Public()
  @Get('docs/:id/annotations')
  async list(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.optionalAuth.resolveUserId(req);
    return this.annotations.listForDoc(id, userId);
  }

  @HttpCode(200)
  @Post('docs/:id/annotations')
  create(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.annotations.createAnnotation(user.id, id, raw);
  }

  @Delete('annotations/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.annotations.deleteAnnotation(user.id, id);
  }

  @HttpCode(200)
  @Post('annotations/:id/vote')
  vote(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.annotations.vote(user.id, id);
  }
}
