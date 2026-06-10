import { Module } from '@nestjs/common';

import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/** ConversationsModule — chat history (list/delete/messages). POST /api/chat ở lại Next tới Wave 7. */
@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
