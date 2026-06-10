import { Global, Module } from '@nestjs/common';

import { LivekitService } from './livekit.service';

/**
 * LivekitModule — @Global: token gen + room admin API dùng chung cho
 * rooms/voice/recording (Wave 4), pattern y hệt infra/ai.
 */
@Global()
@Module({
  providers: [LivekitService],
  exports: [LivekitService],
})
export class LivekitModule {}
