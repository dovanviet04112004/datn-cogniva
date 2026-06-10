import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsInboxService } from './notifications-inbox.service';
import { NotificationsService } from './notifications.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * NotificationsModule — inbox (list/read) + content reports + producer service
 * (notification_log + realtime ping + Expo push).
 * Export NotificationsService cho các module social (groups/DM/rooms) + JobsModule inject.
 */
@Module({
  controllers: [NotificationsController, ReportsController],
  providers: [NotificationsService, NotificationsInboxService, ReportsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
