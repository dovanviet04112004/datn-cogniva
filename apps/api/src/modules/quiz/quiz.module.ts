import { Module } from '@nestjs/common';

import { GamificationModule } from '../gamification/gamification.module';
import { LearningModule } from '../learning/learning.module';
import { LibraryModule } from '../library/library.module';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';
import { QuizAttemptService } from './quiz-attempt.service';
import { QuizGenerateService } from './quiz-generate.service';
import { QuizGradeService } from './quiz-grade.service';

@Module({
  imports: [GamificationModule, LearningModule, LibraryModule],
  controllers: [QuizController, QuestionsController],
  providers: [
    QuizService,
    QuizAttemptService,
    QuizGenerateService,
    QuizGradeService,
    QuestionsService,
  ],
  exports: [QuizGenerateService],
})
export class QuizModule {}
