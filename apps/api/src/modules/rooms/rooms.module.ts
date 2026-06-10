import { Module } from '@nestjs/common';

import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { RoomChatService } from './room-chat.service';
import { RoomTutorService } from './room-tutor.service';
import { RoomRecordingsService } from './room-recordings.service';

/**
 * RoomsModule — Wave 4: study room (CRUD/join/token/chat/AI tutor/moderate/
 * recording). Cần LivekitModule (@Global) có mặt trong app graph — app.module
 * mount cùng wave. Recording PIPELINE (worker) tách ở RoomsPipelineModule để
 * worker không kéo theo controllers/LiveKit.
 */
@Module({
  controllers: [RoomsController],
  providers: [RoomsService, RoomChatService, RoomTutorService, RoomRecordingsService],
  exports: [RoomsService],
})
export class RoomsModule {}
