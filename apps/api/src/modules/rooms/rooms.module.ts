import { Module } from '@nestjs/common';

import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { RoomChatService } from './room-chat.service';
import { RoomTutorService } from './room-tutor.service';
import { RoomRecordingsService } from './room-recordings.service';

@Module({
  controllers: [RoomsController],
  providers: [RoomsService, RoomChatService, RoomTutorService, RoomRecordingsService],
  exports: [RoomsService],
})
export class RoomsModule {}
