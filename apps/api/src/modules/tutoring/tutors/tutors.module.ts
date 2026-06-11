import { Module } from '@nestjs/common';

import { QuizGenerateService } from '../../quiz/quiz-generate.service';
import { TutorKycService } from './kyc.service';
import { TutorsController } from './tutors.controller';
import { TutorsService } from './tutors.service';
import { TutorVerifyQuizService } from './verify-quiz.service';

@Module({
  controllers: [TutorsController],
  providers: [TutorsService, TutorKycService, TutorVerifyQuizService, QuizGenerateService],
})
export class TutorsModule {}
