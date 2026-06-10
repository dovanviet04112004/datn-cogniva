import { Module } from '@nestjs/common';

import { QuizGenerateService } from '../../quiz/quiz-generate.service';
import { TutorKycService } from './kyc.service';
import { TutorsController } from './tutors.controller';
import { TutorsService } from './tutors.service';
import { TutorVerifyQuizService } from './verify-quiz.service';

/**
 * TutorsModule — Wave 7 tutoring: profile wizard (create/availability/subjects/
 * publish) + favorite + KYC + verify-quiz.
 *
 * QuizGenerateService provide lại tại đây (QuizModule không export nó; deps
 * LlmService/CostGuardrailService đều @Global nên instance riêng vô hại —
 * service stateless).
 */
@Module({
  controllers: [TutorsController],
  providers: [TutorsService, TutorKycService, TutorVerifyQuizService, QuizGenerateService],
})
export class TutorsModule {}
