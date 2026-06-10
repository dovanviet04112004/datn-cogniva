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

/**
 * QuizModule — list/generate/detail/attempt + grade 1 câu rời (/questions).
 * LLM (LlmService) + CostGuardrailService từ AiModule @Global, không cần imports.
 */
@Module({
  // GamificationModule → XpService; LearningModule → MasteryUpdateService (BKT);
  // LibraryModule → OutcomeTrackerService (Pillar #5 outcome sau attempt).
  imports: [GamificationModule, LearningModule, LibraryModule],
  controllers: [QuizController, QuestionsController],
  providers: [QuizService, QuizAttemptService, QuizGenerateService, QuizGradeService, QuestionsService],
})
export class QuizModule {}
