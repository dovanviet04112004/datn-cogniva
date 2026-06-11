import { Module } from '@nestjs/common';

import { QuizModule } from '../../quiz/quiz.module';
import { TutorKycService } from './kyc.service';
import { TutorsController } from './tutors.controller';
import { TutorsService } from './tutors.service';
import { TutorVerifyQuizService } from './verify-quiz.service';

@Module({
  imports: [QuizModule],
  controllers: [TutorsController],
  providers: [TutorsService, TutorKycService, TutorVerifyQuizService],
})
export class TutorsModule {}
