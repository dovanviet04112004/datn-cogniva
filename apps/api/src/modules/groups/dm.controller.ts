/**
 * /api/dm/* — port từ route Next (apps/web/src/app/api/dm/**).
 * POST /dm trả 200 (thread đã có) hoặc 201 (mới tạo) → set status động qua
 * passthrough res. POST messages parse body trong service (403 trước 400).
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
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

  /** GET /dm — list threads của user, sorted lastMessageAt DESC. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.dm.listThreads(user.id);
  }

  /** POST /dm — upsert thread idempotent (200 nếu đã có, 201 nếu mới). */
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

  /** GET /dm/:threadId/messages?before=&limit=50 — cursor pagination. */
  @Get(':threadId/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('threadId') threadId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dm.listMessages(user.id, threadId, before ?? null, limit);
  }

  /** POST /dm/:threadId/messages — 201 mặc định của Nest = status route cũ. */
  @Post(':threadId/messages')
  send(
    @CurrentUser() user: AuthUser,
    @Param('threadId') threadId: string,
    @Body() raw: unknown,
  ) {
    return this.dm.createMessage(user, threadId, raw);
  }
}
