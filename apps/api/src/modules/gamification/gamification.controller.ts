/** /api/leaderboard (public) + /api/analytics — port từ route Next (Wave 2). */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { GamificationService } from './gamification.service';

@ApiTags('gamification')
@Controller()
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  @Public()
  @Get('leaderboard')
  async leaderboard(@Query('limit') limitRaw?: string) {
    const limit = Math.min(Number(limitRaw ?? 20) || 20, 100);
    return { leaderboard: await this.gamification.getLeaderboard(limit) };
  }

  @Get('analytics')
  analytics(@CurrentUser() user: AuthUser) {
    return this.gamification.getUserAnalytics(user.id);
  }
}
