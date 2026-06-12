import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { DmService } from './dm.service';
import { createDmThreadSchema, type CreateDmThreadInput } from './dto/dm.dto';

@ApiTags('dm')
@Controller('dm')
export class DmController {
  constructor(private readonly dm: DmService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.dm.listThreads(user.id);
  }

  @Get('threads/:id')
  thread(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dm.getThread(user.id, id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDmThreadSchema)) body: CreateDmThreadInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.dm.createThread(user.id, body);
    res.status(result.httpStatus);
    return result.body;
  }

  @Get(':threadId/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('threadId') threadId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dm.listMessages(user.id, threadId, before ?? null, limit);
  }

  @Post(':threadId/messages')
  send(@CurrentUser() user: AuthUser, @Param('threadId') threadId: string, @Body() raw: unknown) {
    return this.dm.createMessage(user, threadId, raw);
  }
}
