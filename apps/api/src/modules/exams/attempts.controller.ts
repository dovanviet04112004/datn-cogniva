/**
 * /api/attempts/* — port từ route Next (apps/web/src/app/api/attempts/[id]/**).
 * Controller riêng vì path gốc khác /exams (giữ URL y cũ cho client).
 *
 * Mọi POST ở đây route cũ trả 200 (không 201) → @HttpCode(200). Body được
 * service tự safeParse (route cũ check 404/403/409 trước khi parse).
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { AttemptsService } from './attempts.service';

@ApiTags('attempts')
@Controller('attempts')
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  /** GET /attempts/:id — attempt + responses + questions (strip khi chưa reveal). */
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attempts.getAttempt(user.id, id);
  }

  /** POST /attempts/:id/disqualify — owner reject attempt. */
  @HttpCode(200)
  @Post(':id/disqualify')
  disqualify(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attempts.disqualify(user.id, id);
  }

  /** POST /attempts/:id/responses?grade=1 — auto-save (PRACTICE grade ngay). */
  @HttpCode(200)
  @Post(':id/responses')
  saveResponse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() raw: unknown,
    @Query('grade') grade?: string,
  ) {
    return this.attempts.saveResponse(user, id, raw, grade === '1');
  }

  /** POST /attempts/:id/submit — finalize + grade (LLM cho SHORT/ESSAY). */
  @HttpCode(200)
  @Post(':id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attempts.submit(user, id);
  }

  /** POST /attempts/:id/violations — student log batch violation events. */
  @HttpCode(200)
  @Post(':id/violations')
  logViolations(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.attempts.logViolations(user.id, id, raw);
  }

  /** GET /attempts/:id/violations — owner/student xem timeline. */
  @Get(':id/violations')
  listViolations(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attempts.listViolations(user.id, id);
  }
}
