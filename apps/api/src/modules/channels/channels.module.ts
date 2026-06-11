import { Module } from '@nestjs/common';

import { GroupsModule } from '../groups/groups.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiReplyService } from './ai-reply.service';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { MentionNotifyService } from './mention-notify.service';
import { MessagesService } from './messages.service';

@Module({
  imports: [GroupsModule, NotificationsModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, MessagesService, MentionNotifyService, AiReplyService],
  exports: [MentionNotifyService],
})
export class ChannelsModule {}
