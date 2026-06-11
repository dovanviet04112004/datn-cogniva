/**
 * GET /api/healthz — health của riêng NestJS (DB + Redis). Aggregate health
 * cho LB/monitoring (/api/health) port riêng ở health-public.controller.ts.
 */
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';

import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

@ApiTags('health')
@Controller('healthz')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      async () => {
        const ind = this.indicator.check('database');
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return ind.up();
        } catch {
          return ind.down();
        }
      },
      async () => {
        const ind = this.indicator.check('redis');
        return (await this.redis.ping()) ? ind.up() : ind.down();
      },
    ]);
  }
}
