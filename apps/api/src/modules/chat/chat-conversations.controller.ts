/**
 * /api/chat/conversations/* — port từ apps/web/src/app/api/chat/conversations/**.
 *
 * LƯU Ý: đây là BỘ ROUTE RIÊNG, KHÁC /api/conversations đã port Wave 3
 * (modules/conversations) — shape khác: list trả {conversations:[{...messages:n}]}
 * có messageCount + cache 60s; detail trả {conversation, messages} full row
 * để server page hydrate useChat initialMessages.
 */
import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { ChatService } from './chat.service';

@ApiTags('chat')
@Controller('chat/conversations')
export class ChatConversationsController {
  constructor(private readonly chat: ChatService) {}

  /** GET /chat/conversations — list + messageCount, cache-aside 60s. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.chat.listConversations(user.id);
  }

  /** GET /chat/conversations/:id — {conversation, messages} (IDOR → 404). */
  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.getConversation(user.id, id);
  }
}
