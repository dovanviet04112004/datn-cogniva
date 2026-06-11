import { Module } from '@nestjs/common';

import { LearningModule } from '../learning/learning.module';
import { LibraryModule } from '../library/library.module';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';
import { ExamAiService } from './exam-ai.service';
import { ExamGradeService } from './exam-grade.service';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';

@Module({
  imports: [LearningModule, LibraryModule],
  controllers: [ExamsController, AttemptsController],
  providers: [ExamsService, AttemptsService, ExamGradeService, ExamAiService],
})
export class ExamsModule {}
