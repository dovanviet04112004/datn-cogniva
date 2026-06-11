import { Module } from '@nestjs/common';

import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';
import { XpService } from './xp.service';

@Module({
  controllers: [GamificationController],
  providers: [GamificationService, XpService],
  exports: [XpService],
})
export class GamificationModule {}
