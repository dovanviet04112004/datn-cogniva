/**
 * Inngest function `health-monitor` — periodic check + alert.
 *
 * Plan v2 §15.1 W7-8 — observability + DR safety net.
 *
 * Schedule: mỗi 5 phút.
 *
 * Pipeline:
 *   1. Fetch /api/health internal
 *   2. Parse status
 *   3. Nếu critical subsystem down (db, redis) → Sentry alert + log
 *   4. Track uptime metric vào Redis daily counter
 *
 * Vì sao Inngest thay vì pure external monitor (Better Stack, Pingdom):
 *   - Inngest đã có sẵn, không thêm dep
 *   - Internal IP có thể access mà external KHÔNG (vd /api/admin endpoints)
 *   - Free tier Inngest đủ cho mọi check
 *
 * Production nên kết hợp với external (Better Stack 1-min interval) cho
 * "vendor-independent" monitoring khi Inngest tự chết.
 */
import { inngest } from '../client';
import { logger } from '@/lib/observability/logger';
import { getRedis } from '@/lib/redis';

export const healthMonitor = inngest.createFunction(
  {
    id: 'health-monitor',
    name: 'Periodic health check',
    retries: 1,
  },
  // Mỗi 5 phút — 288 check/day, đủ cho Stage 1 SLO
  { cron: '*/5 * * * *' },
  async ({ step, logger: inngestLogger }) => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    const result = await step.run('fetch-health', async () => {
      const start = Date.now();
      try {
        const res = await fetch(`${baseUrl}/api/health`, {
          // Timeout 10s — nếu health endpoint hang lâu hơn = problem
          signal: AbortSignal.timeout(10_000),
        });
        const data = await res.json();
        return {
          ok: res.ok,
          status: res.status,
          latencyMs: Date.now() - start,
          payload: data,
        };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          latencyMs: Date.now() - start,
          payload: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    });

    // Increment counter Redis cho daily uptime calc
    await step.run('record-metric', async () => {
      const redis = getRedis();
      const date = new Date().toISOString().slice(0, 10);
      const bucket = result.ok ? 'up' : 'down';
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(`health:${date}:${bucket}`);
        pipeline.expire(`health:${date}:${bucket}`, 86_400 * 7); // 7 day retention
        await pipeline.exec();
      } catch (err) {
        inngestLogger.warn('health-monitor: redis metric fail', err);
      }
    });

    if (!result.ok) {
      // Hard down — log error → Sentry alert kích hoạt
      logger.error('health-monitor.down', {
        status: result.status,
        latency_ms: result.latencyMs,
        payload: result.payload,
      });
    } else {
      // Service up — check subsystem
      const checks = (result.payload as { checks?: Record<string, { ok: boolean }> }).checks ?? {};
      const failedSubsystems = Object.entries(checks)
        .filter(([_, v]) => !v.ok)
        .map(([k]) => k);
      if (failedSubsystems.length > 0) {
        logger.warn('health-monitor.degraded', {
          failed_subsystems: failedSubsystems,
          latency_ms: result.latencyMs,
        });
      }
    }

    return {
      ok: result.ok,
      latencyMs: result.latencyMs,
    };
  },
);
