import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard')
  getDashboard(@CurrentUser() user: AuthUser) {
    return this.dashboard.getDashboardStats(user.id);
  }
}
