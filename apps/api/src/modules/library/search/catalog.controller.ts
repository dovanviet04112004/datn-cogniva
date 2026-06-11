import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthUser } from '../../../common/auth/session.types';
import { LibraryCatalogService } from './catalog.service';

@ApiTags('library')
@Controller('library')
export class LibraryCatalogController {
  constructor(private readonly catalog: LibraryCatalogService) {}

  @Public()
  @Get('universities')
  listUniversities(@Req() req: Request) {
    const sp = searchParams(req);
    const q = sp.get('q')?.trim() ?? '';
    const limit = Math.min(20, parseInt(sp.get('limit') ?? '10', 10) || 10);
    return this.catalog.listUniversities(q, limit);
  }

  @HttpCode(200)
  @Post('universities')
  createUniversity(@CurrentUser() _user: AuthUser, @Body() raw: unknown) {
    return this.catalog.createUniversity(raw);
  }

  @Public()
  @Get('courses')
  listCourses(@Req() req: Request) {
    const sp = searchParams(req);
    const q = sp.get('q')?.trim() ?? '';
    const universityId = sp.get('universityId')?.trim() || null;
    const limit = Math.min(20, parseInt(sp.get('limit') ?? '10', 10) || 10);
    return this.catalog.listCourses(q, universityId, limit);
  }

  @HttpCode(200)
  @Post('courses')
  createCourse(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.catalog.createCourse(user.id, raw);
  }
}

function searchParams(req: Request): URLSearchParams {
  return new URLSearchParams(req.url.split('?')[1] ?? '');
}
