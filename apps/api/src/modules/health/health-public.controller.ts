/**
 * GET /api/health — port aggregate healthcheck từ apps/web/src/app/api/health/
 * route.ts cho LB/monitoring. PHẢI giữ đúng path + semantics: Caddyfile
 * health_uri và infrastructure/scripts/health-check.sh poll endpoint này,
 * kỳ vọng 503 khi critical (db/redis) down để LB rút khỏi rotation;
 * degraded (livekit/realtime/aiCircuit) vẫn 200. Khác /api/healthz (terminus,
 * chỉ DB+Redis của riêng Nest) — KHÔNG đụng.
 */
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

    // 1. Database primary — ping qua simple query
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

    // 2. Redis (rate limit + cost guardrail) — chung helper với bản web
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

    // 3. AI cost circuit breaker — informational
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

    // 4. LiveKit env (không gọi API thật để tránh side effect)
    checks.livekit = {
      ok: Boolean(
        process.env.NEXT_PUBLIC_LIVEKIT_URL &&
          process.env.LIVEKIT_API_KEY &&
          process.env.LIVEKIT_API_SECRET,
      ),
      detail: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? 'not configured',
    };

    // 5. Realtime (Socket.IO gateway) env — client URL + Redis cho emitter.
    checks.realtime = {
      ok: Boolean(process.env.NEXT_PUBLIC_REALTIME_URL && process.env.REDIS_URL),
      detail: process.env.NEXT_PUBLIC_REALTIME_URL ?? 'not configured',
    };

    // Critical = db + redis. Livekit + realtime + aiCircuit degraded OK.
    const critical = ['db', 'redis'] as const;
    const criticalOk = critical.every((k) => checks[k]?.ok);
    const allOk = Object.values(checks).every((c) => c.ok);

    // Critical down → 503 (Caddy/LB remove from rotation); degraded → 200
    res.status(criticalOk ? 200 : 503);
    // Disable cache layer Cloudflare proxy
    res.setHeader('Cache-Control', 'no-store');

    return {
      status: criticalOk ? (allOk ? 'ok' : 'degraded') : 'down',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
