/**
 * /api/exams/* — port từ route Next (apps/web/src/app/api/exams/**).
 * Mọi route cần session (guard mặc định lo 401 {error:'Unauthorized'}).
 *
 * Status code khớp route cũ: POST tạo (exam/question/attempt mới) trả 201;
 * các POST hành động (join/publish/generate) trả 200 → @HttpCode(200).
 * POST :id/duplicate KHÔNG port — route cũ 0 caller (feature bỏ).
 * Hầu hết body được service tự safeParse vì route cũ check 404/403/409 TRƯỚC
 * khi parse body (pipe sẽ đảo thứ tự status).
 */
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

  /** GET /exams?workspaceId=X|null — list owned + joined (cache 120s). */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('workspaceId') workspaceId?: string) {
    return this.exams.listExams(user.id, workspaceId ?? null);
  }

  /** POST /exams — tạo exam DRAFT (201 như route cũ). */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createExamSchema)) body: CreateExamInput,
  ) {
    return this.exams.createExam(user.id, body);
  }

  /** POST /exams/join — resolve liveCode → examId (route cũ trả 200). */
  @HttpCode(200)
  @Post('join')
  join(@Body() raw: unknown) {
    return this.exams.joinByCode(raw);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.getExam(user.id, id);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.exams.updateExam(user.id, id, raw);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.deleteExam(user.id, id);
  }

  /** GET /exams/:id/attempts — history attempts của chính user. */
  @Get(':id/attempts')
  listAttempts(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attempts.listForExam(user.id, id);
  }

  /**
   * POST /exams/:id/attempts — start attempt mới (201) hoặc resume cái đang
   * IN_PROGRESS (200) — status động nên set qua @Res passthrough.
   */
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

  /**
   * POST /exams/:id/generate-questions — AI sinh câu hỏi (200).
   * Rate-limit aiGenerate chạy TRƯỚC mọi check khác (đúng thứ tự route cũ:
   * 429 ưu tiên hơn 404/403/409/400).
   */
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

  /** GET /exams/:id/proctor — owner xem mọi attempt + cheatRiskScore. */
  @Get(':id/proctor')
  proctor(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.getProctor(user.id, id);
  }

  /** POST /exams/:id/publish — DRAFT → PUBLISHED (route cũ trả 200). */
  @HttpCode(200)
  @Post(':id/publish')
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exams.publishExam(user.id, id);
  }

  /** POST /exams/:id/questions — thêm câu hỏi manual (201). */
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
