import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { checkRedisHealth } from '@cogniva/server-core/redis';

import { Public } from '../../common/decorators/public.decorator';
import { CostGuardrailService } from '../../infra/ai/cost-guardrail.service';
import { PrismaService } from '../../infra/database/prisma.service';

type Check = { ok: boolean; latencyMs?: number; detail?: string; extra?: Record<string, unknown> };

@ApiTags('health')
@Controller('health')
export class HealthPublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costGuardrail: CostGuardrailService,
  ) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, Check> = {};

    const dbStart = performance.now();
    try {
      await this.prisma.$queryRaw`select 1`;
      checks.db = { ok: true, latencyMs: Math.round(performance.now() - dbStart) };
    } catch (err) {
      checks.db = {
        ok: false,
        latencyMs: Math.round(performance.now() - dbStart),
        detail: err instanceof Error ? err.message : 'unknown',
      };
    }

    try {
      const redis = await checkRedisHealth();
      checks.redis = {
        ok: redis.ok,
        latencyMs: redis.latencyMs,
        detail: redis.error,
        extra: { mode: redis.mode },
      };
    } catch (err) {
      checks.redis = {
        ok: false,
        detail: err instanceof Error ? err.message : 'unknown',
      };
    }

    try {
      const spend = await this.costGuardrail.getGlobalHourlySpend();
      checks.aiCircuit = {
        ok: !spend.circuitOpen,
        detail: spend.circuitOpen
          ? `Global AI cost $${spend.spentUsd.toFixed(2)} vượt threshold $${spend.thresholdUsd}`
          : undefined,
        extra: {
          spent_usd: spend.spentUsd,
          threshold_usd: spend.thresholdUsd,
        },
      };
    } catch (err) {
      checks.aiCircuit = {
        ok: false,
        detail: err instanceof Error ? err.message : 'unknown',
      };
    }

    checks.livekit = {
      ok: Boolean(
        process.env.NEXT_PUBLIC_LIVEKIT_URL &&
        process.env.LIVEKIT_API_KEY &&
        process.env.LIVEKIT_API_SECRET,
      ),
      detail: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? 'not configured',
    };

    checks.realtime = {
      ok: Boolean(process.env.NEXT_PUBLIC_REALTIME_URL && process.env.REDIS_URL),
      detail: process.env.NEXT_PUBLIC_REALTIME_URL ?? 'not configured',
    };

    const critical = ['db', 'redis'] as const;
    const criticalOk = critical.every((k) => checks[k]?.ok);
    const allOk = Object.values(checks).every((c) => c.ok);

    res.status(criticalOk ? 200 : 503);
    res.setHeader('Cache-Control', 'no-store');

    return {
      status: criticalOk ? (allOk ? 'ok' : 'degraded') : 'down',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
