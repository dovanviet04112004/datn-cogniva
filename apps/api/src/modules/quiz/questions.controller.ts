/**
 * /api/questions/* — port từ route Next (apps/web/src/app/api/questions/**).
 * Catch-up Wave 3 — bảng plan xếp vào QuizModule. Guard mặc định lo 401.
 */
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { QuestionsService } from './questions.service';
import { gradeQuestionSchema, type GradeQuestionInput } from './dto/quiz.dto';

@ApiTags('questions')
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  /** POST /questions/:id/grade — chấm 1 câu + mastery + marker (route cũ trả 200). */
  @Post(':id/grade')
  @HttpCode(200)
  grade(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(gradeQuestionSchema)) body: GradeQuestionInput,
  ) {
    return this.questions.gradeQuestion(user.id, id, body.answer);
  }
}
