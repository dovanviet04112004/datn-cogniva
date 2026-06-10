import { Module } from '@nestjs/common';

import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';
import { XpService } from './xp.service';

/** GamificationModule — leaderboard + analytics (GĐ3 → analytics-service). */
@Module({
  controllers: [GamificationController],
  providers: [GamificationService, XpService],
  // XpService exported cho các module thưởng XP (learning/quiz/documents...).
  exports: [XpService],
})
export class GamificationModule {}
