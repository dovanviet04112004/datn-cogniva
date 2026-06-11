import { Module } from '@nestjs/common';

import { QueueModule } from '../../../infra/queue/queue.module';
import { AdminGuard } from '../../../common/admin/admin.guard';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import { AdminGroupsController } from './admin-groups.controller';
import { AdminGroupsService } from './admin-groups.service';
import { AdminMiscController } from './admin-misc.controller';
import { AdminMiscService } from './admin-misc.service';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminModerationService } from './admin-moderation.service';
import { AdminNotifyService } from './admin-notify.service';
import { AdminSystemController } from './admin-system.controller';
import { AdminSystemService } from './admin-system.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [QueueModule],
  controllers: [
    AdminUsersController,
    AdminModerationController,
    AdminSystemController,
    AdminGroupsController,
    AdminMiscController,
  ],
  providers: [
    AdminGuard,
    AdminAuditService,
    AdminNotifyService,
    AdminUsersService,
    AdminModerationService,
    AdminSystemService,
    AdminGroupsService,
    AdminMiscService,
  ],
})
export class AdminCoreModule {}
