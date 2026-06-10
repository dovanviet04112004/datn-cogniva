import { Module } from '@nestjs/common';

import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';

/** RealtimeModule — auth endpoint cho Socket.IO gateway (apps/realtime). */
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService],
})
export class RealtimeModule {}
