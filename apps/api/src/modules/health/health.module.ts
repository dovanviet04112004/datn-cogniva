import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { HealthPublicController } from './health-public.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController, HealthPublicController],
})
export class HealthModule {}
