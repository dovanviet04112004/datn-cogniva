import { Module } from '@nestjs/common';

import { ProfileController, UserStatusController } from './users.controller';
import { UsersService } from './users.service';

/** UsersModule — profile + status (Wave 2 pilot; GĐ3 → user-service). */
@Module({
  controllers: [ProfileController, UserStatusController],
  providers: [UsersService],
})
export class UsersModule {}
