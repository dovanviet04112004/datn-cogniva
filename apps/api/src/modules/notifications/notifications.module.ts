import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsInboxService } from './notifications-inbox.service';
import { NotificationsService } from './notifications.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [NotificationsController, ReportsController],
  providers: [NotificationsService, NotificationsInboxService, ReportsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
