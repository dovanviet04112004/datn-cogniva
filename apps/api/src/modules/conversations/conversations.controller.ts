import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { ConversationsService } from './conversations.service';

@ApiTags('conversations')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('workspaceId') workspaceParam?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.min(Number(limitRaw ?? 100), 200);
    return this.conversations.listConversations(user.id, workspaceParam ?? null, limit);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.deleteConversation(user.id, id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.getMessages(user.id, id);
  }
}
