import { Module } from '@nestjs/common';

import { ChatController } from './chat.controller';
import { ChatConversationsController } from './chat-conversations.controller';
import { QuickGenController } from './quick-gen.controller';
import { ChatService } from './chat.service';
import { RetrievalService } from './retrieval/retrieval.service';

/**
 * ChatModule — Wave 7: POST /api/chat streaming (AI SDK data-stream protocol)
 * + GET /api/chat/conversations[/:id] + POST /api/ai/quick-gen.
 * RouterService/SemanticCacheService/guardrail/circuit lấy từ AiModule @Global.
 */
@Module({
  controllers: [ChatController, ChatConversationsController, QuickGenController],
  providers: [ChatService, RetrievalService],
})
export class ChatModule {}
