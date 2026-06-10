import { Module } from '@nestjs/common';

import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';

/** GamificationModule — leaderboard + analytics (GĐ3 → analytics-service). */
@Module({
  controllers: [GamificationController],
  providers: [GamificationService],
})
export class GamificationModule {}
