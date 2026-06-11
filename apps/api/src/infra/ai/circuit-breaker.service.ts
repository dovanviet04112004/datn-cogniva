/**
 * CircuitBreakerService — port từ apps/web/src/lib/ai/circuit-breaker.ts
 * (Upstash idiom → ioredis). State machine CLOSED/OPEN/HALF_OPEN lưu Redis
 * (phân tán giữa nhiều instance), key contract GIỮ NGUYÊN — admin dashboard
 * đọc cùng key: cb:state:{name} (TTL 30s), cb:fail:{name} (INCR window 60s,
 * threshold 5), cb:probe:{name} (SETNX 10s — 1 instance probe). Circuit
 * CLOSED không có key (setState xoá) → listCircuits chỉ thấy non-healthy.
 * Redis lỗi → fail-open mọi nhánh.
 */
import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis/redis.service';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type CircuitConfig = {
  failureThreshold: number;
  windowSec: number;
  resetTimeoutSec: number;
};

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  windowSec: 60,
  resetTimeoutSec: 30,
};

export class CircuitOpenError extends Error {
  override name = 'CircuitOpenError';
}

const stateKey = (name: string) => `cb:state:${name}`;
const failKey = (name: string) => `cb:fail:${name}`;
const probeKey = (name: string) => `cb:probe:${name}`;

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  constructor(private readonly redis: RedisService) {}

  async withCircuitBreaker<T>(
    name: string,
    fn: () => Promise<T>,
    config: Partial<CircuitConfig> = {},
  ): Promise<T> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const state = await this.getState(name);

    if (state === 'OPEN') {
      throw new CircuitOpenError(`Circuit ${name} đang OPEN`);
    }
    if (state === 'HALF_OPEN' && !(await this.acquireProbe(name))) {
      throw new CircuitOpenError(`Circuit ${name} HALF_OPEN, instance khác đang probe`);
    }

    try {
      const result = await fn();
      await this.recordSuccess(name, state);
      return result;
    } catch (err) {
      await this.recordFailure(name, state, cfg);
      throw err;
    }
  }

  async resetCircuit(name: string): Promise<void> {
    await this.setState(name, 'CLOSED');
  }

  async getCircuitState(name: string): Promise<{ state: CircuitState; failCount: number }> {
    const failRaw = await this.redis.getSafe(failKey(name));
    return { state: await this.getState(name), failCount: failRaw ? Number(failRaw) : 0 };
  }

  /** Chỉ circuit non-healthy có key — CLOSED hoàn toàn không xuất hiện. */
  async listCircuits(): Promise<
    Array<{ name: string; state: CircuitState; failCount: number; stateTtl: number }>
  > {
    const client = await this.redis.raw();
    if (!client) return [];
    try {
      const [stateKeys, failKeys] = await Promise.all([
        this.scanKeys('cb:state:*'),
        this.scanKeys('cb:fail:*'),
      ]);
      const names = new Set<string>();
      for (const k of stateKeys) names.add(k.slice('cb:state:'.length));
      for (const k of failKeys) names.add(k.slice('cb:fail:'.length));
      if (names.size === 0) return [];

      return await Promise.all(
        Array.from(names).sort().map(async (name) => {
          const [state, failRaw, ttl] = await Promise.all([
            this.getState(name),
            client.get(failKey(name)),
            client.ttl(stateKey(name)),
          ]);
          return {
            name,
            state,
            failCount: failRaw ? Number(failRaw) : 0,
            stateTtl: typeof ttl === 'number' ? ttl : -1,
          };
        }),
      );
    } catch (err) {
      this.logger.error(`circuit.list.failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async getState(name: string): Promise<CircuitState> {
    const raw = await this.redis.getSafe(stateKey(name));
    if (raw === 'OPEN') return 'OPEN';
    if (raw === 'HALF_OPEN') return 'HALF_OPEN';
    return 'CLOSED';
  }

  private async setState(name: string, state: CircuitState, ttlSec?: number): Promise<void> {
    const client = await this.redis.raw();
    if (!client) return;
    try {
      if (state === 'CLOSED') {
        await client.del(stateKey(name));
        await client.del(failKey(name));
      } else if (ttlSec) {
        await client.set(stateKey(name), state, 'EX', ttlSec);
      } else {
        await client.set(stateKey(name), state);
      }
      this.logger.log(`circuit.state.change ${name} → ${state}`);
    } catch (err) {
      this.logger.error(`circuit.state.set_failed ${name}: ${(err as Error).message}`);
    }
  }

  private async acquireProbe(name: string): Promise<boolean> {
    const client = await this.redis.raw();
    if (!client) return true;
    try {
      return (await client.set(probeKey(name), '1', 'EX', 10, 'NX')) === 'OK';
    } catch {
      return true;
    }
  }

  private async recordSuccess(name: string, currentState: CircuitState): Promise<void> {
    if (currentState === 'HALF_OPEN') {
      await this.setState(name, 'CLOSED');
    } else {
      const client = await this.redis.raw();
      await client?.del(failKey(name)).catch(() => {});
    }
  }

  private async recordFailure(
    name: string,
    currentState: CircuitState,
    config: CircuitConfig,
  ): Promise<void> {
    if (currentState === 'HALF_OPEN') {
      await this.setState(name, 'OPEN', config.resetTimeoutSec);
      return;
    }
    const client = await this.redis.raw();
    if (!client) return;
    try {
      const replies = await client.pipeline().incr(failKey(name)).expire(failKey(name), config.windowSec).exec();
      const count = Number(replies?.[0]?.[1] ?? 0);
      if (count >= config.failureThreshold) {
        await this.setState(name, 'OPEN', config.resetTimeoutSec);
        this.logger.warn(`circuit.opened ${name} fail_count=${count}`);
      }
    } catch (err) {
      this.logger.warn(`circuit.record_failure_redis_error ${name}: ${(err as Error).message}`);
    }
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const client = await this.redis.raw();
    if (!client) return [];
    const all: string[] = [];
    let cursor = '0';
    for (let i = 0; i < 20; i++) {
      const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      all.push(...keys);
      if (cursor === '0' || all.length > 1000) break;
    }
    return all;
  }
}
