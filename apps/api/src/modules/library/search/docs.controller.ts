import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Req,
  Body,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthUser } from '../../../common/auth/session.types';
import { LibraryDocsService, NEAR_DUPLICATE_THRESHOLD, SIMILAR_THRESHOLD } from './docs.service';
import { OptionalAuthService } from '../../../common/auth/optional-auth.service';

@ApiTags('library')
@Controller('library/docs')
export class LibraryDocsController {
  constructor(
    private readonly docs: LibraryDocsService,
    private readonly optionalAuth: OptionalAuthService,
  ) {}

  @Public()
  @Get(':id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    const user = await this.optionalAuth.resolveUser(req);
    return this.docs.getDocDetail(id, user?.id ?? null);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.docs.deleteDoc(user.id, id);
  }

  @Public()
  @Get(':id/related')
  async related(@Param('id') id: string) {
    try {
      const related = await this.docs.findRelatedDocs(id);
      return { related };
    } catch (err) {
      throw new HttpException({ error: (err as Error).message }, 500);
    }
  }

  @Public()
  @Get(':id/duplicates')
  async duplicates(@Param('id') id: string, @Req() req: Request) {
    const nearOnly = searchParams(req).get('nearOnly') === 'true';
    const threshold = nearOnly ? NEAR_DUPLICATE_THRESHOLD : SIMILAR_THRESHOLD;

    try {
      const matches = await this.docs.findDuplicateMatches(id, threshold);
      return {
        matches,
        threshold,
        hasNearDuplicate: matches.some((m) => m.isNearDuplicate),
      };
    } catch (err) {
      throw new HttpException({ error: (err as Error).message }, 500);
    }
  }

  @Public()
  @Get(':id/prereq-check')
  async prereqCheck(@Param('id') id: string, @Req() req: Request) {
    const user = await this.optionalAuth.resolveUser(req);
    return this.docs.prereqCheck(id, user?.id ?? null);
  }

  @Public()
  @Get(':id/reviews')
  listReviews(@Param('id') id: string, @Req() req: Request) {
    const sp = searchParams(req);
    const limit = Math.min(50, parseInt(sp.get('limit') ?? '20', 10) || 20);
    const offset = parseInt(sp.get('offset') ?? '0', 10) || 0;
    return this.docs.listReviews(id, limit, offset);
  }

  @HttpCode(200)
  @Post(':id/reviews')
  postReview(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.docs.postReview(user.id, id, raw);
  }
}

function searchParams(req: Request): URLSearchParams {
  return new URLSearchParams(req.url.split('?')[1] ?? '');
}
