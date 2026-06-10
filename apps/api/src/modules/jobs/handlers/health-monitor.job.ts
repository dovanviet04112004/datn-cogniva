/**
 * Job `health-monitor` (mỗi 5') — fetch /api/health (aggregate của Next, còn
 * sống tới W7) + track uptime counter Redis 7 ngày + log alert khi down/degraded.
 * Idempotent về side-effect (chỉ INCR metric). Port từ apps/web jobs.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRedis, logger } from '@cogniva/server-core';

@Injectable()
export class HealthMonitorJob {
  constructor(private readonly config: ConfigService) {}

  async run(): Promise<{ ok: boolean; latencyMs: number }> {
    const baseUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';

    const start = Date.now();
    let result: { ok: boolean; status: number; latencyMs: number; payload: unknown };
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(10_000) });
      result = { ok: res.ok, status: res.status, latencyMs: Date.now() - start, payload: await res.json() };
    } catch (err) {
      result = {
        ok: false,
        status: 0,
        latencyMs: Date.now() - start,
        payload: { error: err instanceof Error ? err.message : String(err) },
      };
    }

    // Daily uptime counter (7 ngày) — lệch nhẹ khi retry là vô hại.
    const date = new Date().toISOString().slice(0, 10);
    const bucket = result.ok ? 'up' : 'down';
    try {
      const pipeline = getRedis().pipeline();
      pipeline.incr(`health:${date}:${bucket}`);
      pipeline.expire(`health:${date}:${bucket}`, 86_400 * 7);
      await pipeline.exec();
    } catch (err) {
      logger.warn('health-monitor.redis-metric-fail', { error: String(err) });
    }

    if (!result.ok) {
      logger.error('health-monitor.down', {
        status: result.status,
        latency_ms: result.latencyMs,
        payload: result.payload,
      });
    } else {
      const checks = (result.payload as { checks?: Record<string, { ok: boolean }> }).checks ?? {};
      const failed = Object.entries(checks)
        .filter(([, v]) => !v.ok)
        .map(([k]) => k);
      if (failed.length > 0) {
        logger.warn('health-monitor.degraded', { failed_subsystems: failed, latency_ms: result.latencyMs });
      }
    }

    return { ok: result.ok, latencyMs: result.latencyMs };
  }
}
