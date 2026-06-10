/**
 * GET /api/health — endpoint healthcheck cho monitoring + load balancer.
 *
 * Trả status từng subsystem:
 *   - db: ping Postgres
 *   - livekit: env có cấu hình không (lazy — không gọi LiveKit API mỗi check
 *     để tránh DDoS chính mình)
 *   - realtime: env có cấu hình không
 *
 * Caddy production dùng endpoint này (xem caddy/Caddyfile health_uri).
 * Cron `infrastructure/scripts/health-check.sh` cũng poll endpoint này
 * trên app server.
 */
import { db, dbReplica, hasReplica } from '@cogniva/db';
import { sql } from 'drizzle-orm';

import { checkRedisHealth } from '@/lib/redis';
import { getGlobalHourlySpend } from '@/lib/observability/cost-guardrail';

export const runtime = 'nodejs';
// Force dynamic — health check phải reflect realtime state, không cache
export const dynamic = 'force-dynamic';

type Check = { ok: boolean; latencyMs?: number; detail?: string; extra?: Record<string, unknown> };

export async function GET() {
  const checks: Record<string, Check> = {};

  // 1. Database primary — ping qua simple query
  const dbStart = performance.now();
  try {
    await db.execute(sql`select 1`);
    checks.db = { ok: true, latencyMs: Math.round(performance.now() - dbStart) };
  } catch (err) {
    checks.db = {
      ok: false,
      latencyMs: Math.round(performance.now() - dbStart),
      detail: err instanceof Error ? err.message : 'unknown',
    };
  }

  // 1b. Database replica (Stage 1 §15.1 W3 — optional)
  if (hasReplica()) {
    const replicaStart = performance.now();
    try {
      await dbReplica.execute(sql`select 1`);
      checks.dbReplica = {
        ok: true,
        latencyMs: Math.round(performance.now() - replicaStart),
      };
    } catch (err) {
      // Replica down KHÔNG fail toàn site — caller fallback primary
      checks.dbReplica = {
        ok: false,
        latencyMs: Math.round(performance.now() - replicaStart),
        detail: err instanceof Error ? err.message : 'unknown',
      };
    }
  }

  // 2. Redis (Stage 1 §15.1 W1 — required for rate limit + cost guardrail)
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

  // 3. AI cost circuit breaker (Stage 1 §15.1 W6) — informational
  try {
    const spend = await getGlobalHourlySpend();
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

  // Critical = db + redis. Replica + livekit + realtime degraded OK.
  const critical = ['db', 'redis'] as const;
  const criticalOk = critical.every((k) => checks[k]?.ok);
  const allOk = Object.values(checks).every((c) => c.ok);

  return Response.json(
    {
      status: criticalOk ? (allOk ? 'ok' : 'degraded') : 'down',
      timestamp: new Date().toISOString(),
      checks,
    },
    {
      // Critical down → 503 (Caddy/LB sẽ remove from rotation)
      // Degraded (non-critical) → 200 (still serve, banner show user)
      status: criticalOk ? 200 : 503,
      // Disable cache layer Cloudflare proxy
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
