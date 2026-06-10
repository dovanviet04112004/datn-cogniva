import { Module } from '@nestjs/common';

import { AtomsController } from './atoms.controller';
import { AtomsService } from './atoms.service';
import { MasteryController } from './mastery.controller';
import { MasteryService } from './mastery.service';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { StudyPlanController } from './study-plan.controller';
import { StudyPlanService } from './study-plan.service';

/** LearningModule — atoms/mastery/notes/study-plan (GĐ3 → learning-service). */
@Module({
  controllers: [MasteryController, AtomsController, NotesController, StudyPlanController],
  providers: [MasteryService, AtomsService, NotesService, StudyPlanService],
})
export class LearningModule {}
