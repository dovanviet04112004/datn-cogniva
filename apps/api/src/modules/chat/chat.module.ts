import { Module } from '@nestjs/common';

import { ChatController } from './chat.controller';
import { ChatConversationsController } from './chat-conversations.controller';
import { QuickGenController } from './quick-gen.controller';
import { ChatService } from './chat.service';
import { RetrievalService } from './retrieval/retrieval.service';

@Module({
  controllers: [ChatController, ChatConversationsController, QuickGenController],
  providers: [ChatService, RetrievalService],
})
export class ChatModule {}
