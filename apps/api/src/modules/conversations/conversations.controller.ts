/**
 * /api/conversations/* — port từ apps/web/src/app/api/conversations/**.
 * Tất cả route cần session (guard global lo 401 {error:'Unauthorized'}).
 * Route cũ [id]/route.ts CHỈ export DELETE (GET metadata là future) → không
 * port GET /conversations/:id.
 */
import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { ConversationsService } from './conversations.service';

@ApiTags('conversations')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  /** GET /conversations?workspaceId=X&limit=100 — parse y route cũ (cap 200). */
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
