/**
 * /api/library/docs/* — port từ route Next (apps/web/src/app/api/library/**).
 *
 * Catalog là nội dung CÔNG KHAI: list/detail/related/duplicates/reviews GET
 * không check session ở route cũ → @Public(). Detail + prereq-check có hành
 * vi per-user khi login (view history, mastery) → resolve session best-effort
 * qua OptionalAuthService.
 *
 * Body POST safeParse trong service (shape lỗi cũ {error:'Invalid body',
 * details} ≠ ZodValidationPipe {error: flatten} → không dùng pipe).
 */
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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import {
  LibraryDocsService,
  NEAR_DUPLICATE_THRESHOLD,
  SIMILAR_THRESHOLD,
} from './library-docs.service';
import { OptionalAuthService } from '../../common/auth/optional-auth.service';

@ApiTags('library')
@Controller('library/docs')
export class LibraryDocsController {
  constructor(
    private readonly docs: LibraryDocsService,
    private readonly optionalAuth: OptionalAuthService,
  ) {}

  /* GET /library/docs (list hybrid search) KHÔNG port — 0 caller: LibraryGrid
     SSR query DB trực tiếp qua lib hybridSearchLibraryDocs (write-path-first).
     HybridSearchService vẫn sống cho goal-planner. */

  /** GET /library/docs/:id — detail public, session (nếu có) chỉ để tracking. */
  @Public()
  @Get(':id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    const user = await this.optionalAuth.resolveUser(req);
    return this.docs.getDocDetail(id, user?.id ?? null);
  }

  /** DELETE /library/docs/:id — owner xoá (set status=HIDDEN, không hard delete). */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.docs.deleteDoc(user.id, id);
  }

  /** GET /library/docs/:id/related — Bonus #10: 3 docs bổ trợ (prereq/next/practice). */
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

  /** GET /library/docs/:id/duplicates — ?nearOnly=true chỉ list ≥ 0.92. */
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

  /** GET /library/docs/:id/prereq-check — không login → full prereq list (no mastery filter). */
  @Public()
  @Get(':id/prereq-check')
  async prereqCheck(@Param('id') id: string, @Req() req: Request) {
    const user = await this.optionalAuth.resolveUser(req);
    return this.docs.prereqCheck(id, user?.id ?? null);
  }

  /** GET /library/docs/:id/reviews — list reviews sort by helpful. */
  @Public()
  @Get(':id/reviews')
  listReviews(@Param('id') id: string, @Req() req: Request) {
    const sp = searchParams(req);
    const limit = Math.min(50, parseInt(sp.get('limit') ?? '20', 10) || 20);
    const offset = parseInt(sp.get('offset') ?? '0', 10) || 0;
    return this.docs.listReviews(id, limit, offset);
  }

  /** POST /library/docs/:id/reviews — upsert review (1/user/doc), route cũ trả 200. */
  @HttpCode(200)
  @Post(':id/reviews')
  postReview(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.docs.postReview(user.id, id, raw);
  }
}

/** Query string y `new URL(request.url).searchParams` route cũ. */
function searchParams(req: Request): URLSearchParams {
  return new URLSearchParams(req.url.split('?')[1] ?? '');
}

