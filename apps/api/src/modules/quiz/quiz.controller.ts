import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { QuizService } from './quiz.service';
import { QuizAttemptService } from './quiz-attempt.service';
import { attemptQuizSchema, generateQuizSchema, type AttemptQuizInput } from './dto/quiz.dto';

@ApiTags('quiz')
@Controller('quiz')
export class QuizController {
  constructor(
    private readonly quiz: QuizService,
    private readonly attempt: QuizAttemptService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
    @Query('workspaceId') workspaceParam?: string,
  ) {
    const limit = Math.min(Number(limitRaw ?? 50), 200);
    const offset = Math.max(Number(offsetRaw ?? 0), 0);
    return this.quiz.listQuizzes(user.id, limit, offset, workspaceParam ?? null);
  }

  @Post('generate')
  @HttpCode(200)
  async generate(
    @CurrentUser() user: AuthUser,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rl = await checkLimit(`aigen:${user.id}`, 'aiGenerate');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'Too many requests' }, 429);
    }

    const parsed = generateQuizSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    return this.quiz.generateQuiz(user, parsed.data);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('withAnswers') withAnswers?: string,
  ) {
    return this.quiz.getQuiz(user.id, id, withAnswers === '1');
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quiz.deleteQuiz(user.id, id);
  }

  @Post(':id/attempt')
  @HttpCode(200)
  submitAttempt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(attemptQuizSchema)) body: AttemptQuizInput,
  ) {
    return this.attempt.submitAttempt(user.id, id, body);
  }
}
