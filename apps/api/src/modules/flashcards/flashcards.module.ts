import { Module } from '@nestjs/common';

import { GamificationModule } from '../gamification/gamification.module';
import { LearningModule } from '../learning/learning.module';
import { FlashcardsController } from './flashcards.controller';
import { FlashcardsService } from './flashcards.service';
import { FlashcardGenService } from './flashcard-gen.service';

/**
 * FlashcardsModule — FSRS review + queue/stats + AI gen + ảnh occlusion
 * (GĐ3 → learning-service). XpService từ Gamification, MasteryUpdateService
 * từ Learning; Llm/CostGuardrail/Storage là @Global nên không cần imports.
 */
@Module({
  imports: [GamificationModule, LearningModule],
  controllers: [FlashcardsController],
  providers: [FlashcardsService, FlashcardGenService],
})
export class FlashcardsModule {}
