import { Module } from '@nestjs/common';

import { SpikeController } from './spike.controller';

/** ⚠️ SPIKE streaming — XÓA khi ChatModule port xong (Wave 7). */
@Module({
  controllers: [SpikeController],
})
export class SpikeModule {}
