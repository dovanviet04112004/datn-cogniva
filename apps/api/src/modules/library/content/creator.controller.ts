import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../../common/auth/session.types';
import { LibraryCreatorService } from './creator.service';

@ApiTags('library')
@Controller('library')
export class LibraryCreatorController {
  constructor(private readonly creator: LibraryCreatorService) {}

  @Get('creator/dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.creator.getDashboard(user.id);
  }

  @Get('remix/available')
  remixAvailable(@CurrentUser() user: AuthUser) {
    return this.creator.getRemixAvailable(user.id);
  }
}
