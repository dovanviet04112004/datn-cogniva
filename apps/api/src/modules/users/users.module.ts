import { Module } from '@nestjs/common';

import { ProfileController, UserStatusController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [ProfileController, UserStatusController],
  providers: [UsersService],
})
export class UsersModule {}
