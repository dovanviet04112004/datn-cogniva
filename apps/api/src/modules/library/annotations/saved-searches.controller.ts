import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../../common/auth/session.types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { LibrarySavedSearchesService } from './saved-searches.service';

@ApiTags('library')
@Controller('library/saved-searches')
export class LibrarySavedSearchesController {
  constructor(private readonly savedSearches: LibrarySavedSearchesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.savedSearches.list(user.id);
  }

  @HttpCode(200)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.savedSearches.create(user.id, raw);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.savedSearches.remove(user.id, id);
  }
}
