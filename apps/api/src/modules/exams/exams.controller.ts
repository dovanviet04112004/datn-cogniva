import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { AttemptsService } from './attempts.service';
import { ExamsService } from './exams.service';
import { createExamSchema, type CreateExamInput } from './dto/exams.dto';

@ApiTags('exams')
@Controller('exams')
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly attempts: AttemptsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('workspaceId') workspaceId?: string) {
    return this.exams.listExams(user.id, workspaceId ?? null);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createExamSchema)) body: CreateExamInput,
  ) {
    return this.exams.createExam(user.id, body);
  }

  @HttpCode(200)
  @Post('join')
  join(@Body() raw: unknown) {
    return this.exams.joinByCode(raw);
  }

  @Get('lookup')
  lookup(@Query('code') code?: string) {
    return this.exams.lookupByCode(code);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.getExam(user.id, id);
  }

  @Get(':id/redirect-info')
  redirectInfo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.redirectInfo(user.id, id);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.exams.updateExam(user.id, id, raw);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.deleteExam(user.id, id);
  }

  @Get(':id/attempts')
  listAttempts(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attempts.listForExam(user.id, id);
  }

  @Post(':id/attempts')
  async startAttempt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
    @Headers('cf-connecting-ip') cfIp?: string,
    @Headers('x-forwarded-for') forwardedFor?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const out = await this.attempts.startAttempt(user.id, id, { cfIp, forwardedFor, userAgent });
    res.status(out.resumed ? 200 : 201);
    return out;
  }

  @HttpCode(200)
  @Post(':id/generate-questions')
  async generateQuestions(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rl = await checkLimit(`aigen:${user.id}`, 'aiGenerate');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'Too many requests' }, 429);
    }
    return this.exams.generateQuestions(user, id, raw);
  }

  @Get(':id/proctor')
  proctor(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.getProctor(user.id, id);
  }

  @HttpCode(200)
  @Post(':id/publish')
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.publishExam(user.id, id);
  }

  @Post(':id/questions')
  addQuestion(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.exams.addQuestion(user.id, id, raw);
  }

  @Put(':id/questions/:qId')
  updateQuestion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('qId') qId: string,
    @Body() raw: unknown,
  ) {
    return this.exams.updateQuestion(user.id, id, qId, raw);
  }

  @Delete(':id/questions/:qId')
  removeQuestion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('qId') qId: string,
  ) {
    return this.exams.deleteQuestion(user.id, id, qId);
  }
}
