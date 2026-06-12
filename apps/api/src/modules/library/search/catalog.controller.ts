import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthUser } from '../../../common/auth/session.types';
import { OptionalAuthService } from '../../../common/auth/optional-auth.service';
import { LibraryCatalogService } from './catalog.service';
import { LibraryDiscoveryService } from './discovery.service';

@ApiTags('library')
@Controller('library')
export class LibraryCatalogController {
  constructor(
    private readonly catalog: LibraryCatalogService,
    private readonly discovery: LibraryDiscoveryService,
    private readonly optionalAuth: OptionalAuthService,
  ) {}

  @Public()
  @Get('stats/hub')
  hubStats() {
    return this.discovery.getHubStats();
  }

  @Public()
  @Get('karma/board')
  karmaBoard() {
    return this.discovery.getKarmaBoard();
  }

  @Public()
  @Get('browse/universities')
  universitiesDirectory() {
    return this.discovery.getUniversitiesDirectory();
  }

  @Get('recently-viewed')
  recentlyViewed(@CurrentUser() user: AuthUser) {
    return this.discovery.getRecentlyViewed(user.id);
  }

  @Public()
  @Get('hub-sections')
  async hubSections(@Req() req: Request) {
    const user = await this.optionalAuth.resolveUser(req);
    return this.discovery.getHubSections(user?.id ?? null);
  }

  @Public()
  @Get('universities/:id')
  async universityDetail(@Param('id') id: string) {
    const detail = await this.discovery.getUniversityDetail(id);
    if (!detail) throw new NotFoundException();
    return detail;
  }

  @Public()
  @Get('courses/:id')
  async courseDetail(@Param('id') id: string) {
    const course = await this.discovery.getCourseDetail(id);
    if (!course) throw new NotFoundException();
    return course;
  }

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
