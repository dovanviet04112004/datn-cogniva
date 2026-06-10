import { Module } from '@nestjs/common';

import { SpikeController } from './spike.controller';

/** ⚠️ SPIKE Wave 0 — XÓA Ở WAVE 1. */
@Module({
  controllers: [SpikeController],
})
export class SpikeModule {}
