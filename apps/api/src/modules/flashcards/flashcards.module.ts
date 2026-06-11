import { Module } from '@nestjs/common';

import { GamificationModule } from '../gamification/gamification.module';
import { LearningModule } from '../learning/learning.module';
import { FlashcardsController } from './flashcards.controller';
import { FlashcardsService } from './flashcards.service';
import { FlashcardGenService } from './flashcard-gen.service';

@Module({
  imports: [GamificationModule, LearningModule],
  controllers: [FlashcardsController],
  providers: [FlashcardsService, FlashcardGenService],
})
export class FlashcardsModule {}
