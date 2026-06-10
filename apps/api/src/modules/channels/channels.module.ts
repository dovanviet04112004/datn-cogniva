/**
 * ChannelsModule — Wave 4 channels-core: message text/forum/thread + mention
 * notify + AI reply. Voice/stage/record nằm ở channels-voice.module.ts RIÊNG
 * (agent voice own) — đừng gộp vào đây.
 */
import { Module } from '@nestjs/common';

import { GroupsModule } from '../groups/groups.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiReplyService } from './ai-reply.service';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { MentionNotifyService } from './mention-notify.service';
import { MessagesService } from './messages.service';

@Module({
  // GroupsModule → PermissionsService; NotificationsModule → push/log mention.
  // LlmService/PrismaService @Global — inject thẳng không cần import.
  imports: [GroupsModule, NotificationsModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, MessagesService, MentionNotifyService, AiReplyService],
  // MentionNotifyService export cho module social khác (DM) tái dùng nếu cần.
  exports: [MentionNotifyService],
})
export class ChannelsModule {}
