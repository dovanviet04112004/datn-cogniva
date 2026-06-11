import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { AttemptsService } from './attempts.service';

@ApiTags('attempts')
@Controller('attempts')
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attempts.getAttempt(user.id, id);
  }

  @HttpCode(200)
  @Post(':id/disqualify')
  disqualify(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attempts.disqualify(user.id, id);
  }

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

  @HttpCode(200)
  @Post(':id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attempts.submit(user, id);
  }

  @HttpCode(200)
  @Post(':id/violations')
  logViolations(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.attempts.logViolations(user.id, id, raw);
  }

  @Get(':id/violations')
  listViolations(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attempts.listViolations(user.id, id);
  }
}
