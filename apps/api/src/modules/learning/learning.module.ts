import { Module } from '@nestjs/common';

import { GamificationModule } from '../gamification/gamification.module';
import { AtomsController } from './atoms.controller';
import { AtomsService } from './atoms.service';
import { MasteryController } from './mastery.controller';
import { MasteryService } from './mastery.service';
import { MasteryUpdateService } from './mastery-update.service';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { StudyPlanController } from './study-plan.controller';
import { StudyPlanService } from './study-plan.service';

@Module({
  imports: [GamificationModule],
  controllers: [MasteryController, AtomsController, NotesController, StudyPlanController],
  providers: [MasteryService, AtomsService, NotesService, StudyPlanService, MasteryUpdateService],
  exports: [MasteryUpdateService],
})
export class LearningModule {}
