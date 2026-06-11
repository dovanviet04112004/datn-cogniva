import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { NotificationsInboxService } from './notifications-inbox.service';
import { markReadSchema, type MarkReadInput } from './dto/notifications.dto';

const MAX_LIMIT = 50;

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly inbox: NotificationsInboxService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limitRaw?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const raw = Number(limitRaw ?? 20);
    const limit = Number.isFinite(raw) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw))) : 20;
    return this.inbox.list(user.id, limit, unreadOnly === '1');
  }

  @Post('read')
  @HttpCode(200)
  markRead(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(markReadSchema)) body: MarkReadInput,
  ) {
    return this.inbox.markRead(user.id, body);
  }
}
