/**
 * /api/library/{universities,courses,karma/leaderboard} — port từ route Next.
 * GET đều public (autocomplete + leaderboard không cần login ở route cũ);
 * POST cần session, trả 200 (route cũ NextResponse.json mặc định).
 */
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { LibraryCatalogService } from './library-catalog.service';

@ApiTags('library')
@Controller('library')
export class LibraryCatalogController {
  constructor(private readonly catalog: LibraryCatalogService) {}

  /** GET /library/universities?q=&limit= — autocomplete cho upload. */
  @Public()
  @Get('universities')
  listUniversities(@Req() req: Request) {
    const sp = searchParams(req);
    const q = sp.get('q')?.trim() ?? '';
    const limit = Math.min(20, parseInt(sp.get('limit') ?? '10', 10) || 10);
    return this.catalog.listUniversities(q, limit);
  }

  /** POST /library/universities — tạo university (UGC), dedup theo slug. */
  @HttpCode(200)
  @Post('universities')
  createUniversity(@CurrentUser() _user: AuthUser, @Body() raw: unknown) {
    return this.catalog.createUniversity(raw);
  }

  /** GET /library/courses?q=&universityId=&limit= — autocomplete course. */
  @Public()
  @Get('courses')
  listCourses(@Req() req: Request) {
    const sp = searchParams(req);
    const q = sp.get('q')?.trim() ?? '';
    const universityId = sp.get('universityId')?.trim() || null;
    const limit = Math.min(20, parseInt(sp.get('limit') ?? '10', 10) || 10);
    return this.catalog.listCourses(q, universityId, limit);
  }

  /** POST /library/courses — tạo course (UGC), dedup theo (university, slug). */
  @HttpCode(200)
  @Post('courses')
  createCourse(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.catalog.createCourse(user.id, raw);
  }

  /* GET karma/leaderboard KHÔNG port — 0 caller: trang /library/karma SSR
     query DB trực tiếp qua lib getKarmaBoard (write-path-first). */
}

/** Query string y `new URL(request.url).searchParams` route cũ. */
function searchParams(req: Request): URLSearchParams {
  return new URLSearchParams(req.url.split('?')[1] ?? '');
}
