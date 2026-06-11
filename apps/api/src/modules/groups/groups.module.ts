import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsService } from './permissions.service';
import { GroupsService } from './groups.service';
import { GroupChannelsService } from './group-channels.service';
import { GroupMembersService } from './group-members.service';
import { DmService } from './dm.service';
import { GroupsController } from './groups.controller';
import { GroupAdminController } from './group-admin.controller';
import { DmController } from './dm.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [GroupsController, GroupAdminController, DmController],
  providers: [
    PermissionsService,
    GroupsService,
    GroupChannelsService,
    GroupMembersService,
    DmService,
  ],
  exports: [PermissionsService],
})
export class GroupsModule {}
