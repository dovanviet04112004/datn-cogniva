/** /api/search + /api/chunks/:id — port từ route Next (global search + chunk preview). */
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** GET /search?q=text&limit=10 — limit default 10, cap 30 (như route cũ). */
  @Get()
  async globalSearch(
    @CurrentUser() user: AuthUser,
    @Query('q') qRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const q = (qRaw ?? '').trim();
    const limit = Math.min(Number(limitRaw ?? 10), 30);
    return { results: await this.search.globalSearch(user.id, q, limit) };
  }
}

@ApiTags('chunks')
@Controller('chunks')
export class ChunksController {
  constructor(private readonly search: SearchService) {}

  /** GET /chunks/:id — DocPreviewPanel load full chunk + neighbors khi click citation. */
  @Get(':id')
  getChunk(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.search.getChunk(user.id, id);
  }
}
