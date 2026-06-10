/**
 * Circuit breaker — Redis-backed, distributed across Vercel instances.
 *
 * State machine 3 trạng thái:
 *   CLOSED   - bình thường, request đi qua, đếm fail.
 *   OPEN     - sau N fail liên tiếp, block toàn bộ N giây. Fail nhanh, không
 *              spawn thêm request đến provider đang chết.
 *   HALF_OPEN - sau timeout, cho qua 1 request test. Pass → CLOSED. Fail → OPEN.
 *
 * Khác với opossum/gobreaker:
 *   - State lưu Redis → share giữa nhiều Vercel instance. 1 instance phát
 *     hiện Anthropic down → toàn fleet nhanh chóng nhận biết, không phải mỗi
 *     instance học lại từ đầu.
 *   - Half-open distributed: dùng SETNX để chỉ 1 instance probe đầu tiên.
 *
 * Lock state per (provider, model) tuple — Anthropic Sonnet có thể fail
 * trong khi Haiku còn OK, không sweep cả nhà cung cấp.
 */
import { getRedis } from '../redis';
import { logger } from '../observability/logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type CircuitConfig = {
  /** Fail liên tiếp trước khi mở. */
  failureThreshold: number;
  /** Window đếm fail (giây). Reset count khi pass. */
  windowSec: number;
  /** Thời gian OPEN trước khi chuyển HALF_OPEN. */
  resetTimeoutSec: number;
};

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  windowSec: 60,
  resetTimeoutSec: 30,
};

function stateKey(name: string): string {
  return `cb:state:${name}`;
}
function failKey(name: string): string {
  return `cb:fail:${name}`;
}
function probeKey(name: string): string {
  return `cb:probe:${name}`;
}

/**
 * Lấy state hiện tại từ Redis.
 */
async function getState(name: string): Promise<CircuitState> {
  const redis = getRedis();
  try {
    const raw = await redis.get(stateKey(name));
    if (raw === 'OPEN') return 'OPEN';
    if (raw === 'HALF_OPEN') return 'HALF_OPEN';
    return 'CLOSED';
  } catch {
    // Redis fail → fail-open (cho qua), tốt hơn block toàn bộ
    return 'CLOSED';
  }
}

/**
 * Set state + log transition.
 */
async function setState(
  name: string,
  state: CircuitState,
  ttlSec?: number,
): Promise<void> {
  const redis = getRedis();
  try {
    if (state === 'CLOSED') {
      await redis.del(stateKey(name));
      await redis.del(failKey(name));
    } else {
      await redis.set(stateKey(name), state, ttlSec ? { ex: ttlSec } : undefined);
    }
    logger.info('circuit.state.change', { circuit: name, state });
  } catch (err) {
    logger.error('circuit.state.set_failed', {
      circuit: name,
      state,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Acquire probe permission khi state=HALF_OPEN.
 * Dùng SETNX để chỉ 1 instance được probe — tránh thundering herd.
 * @returns true nếu được probe, false nếu instance khác đang probe.
 */
async function acquireProbe(name: string): Promise<boolean> {
  const redis = getRedis();
  try {
    const result = await redis.set(probeKey(name), '1', { ex: 10, nx: true });
    return result === 'OK';
  } catch {
    return true; // Redis fail → cho probe (better than total block)
  }
}

/**
 * Record success — reset fail counter, transition về CLOSED nếu HALF_OPEN.
 */
async function recordSuccess(name: string, currentState: CircuitState): Promise<void> {
  if (currentState === 'HALF_OPEN') {
    await setState(name, 'CLOSED');
  } else {
    // CLOSED: clear fail counter định kỳ (đã có TTL nên thực ra không cần)
    const redis = getRedis();
    try {
      await redis.del(failKey(name));
    } catch {
      /* swallow */
    }
  }
}

/**
 * Record failure — incr counter, mở circuit nếu vượt threshold.
 */
async function recordFailure(
  name: string,
  currentState: CircuitState,
  config: CircuitConfig,
): Promise<void> {
  const redis = getRedis();

  if (currentState === 'HALF_OPEN') {
    // Probe fail → quay lại OPEN
    await setState(name, 'OPEN', config.resetTimeoutSec);
    return;
  }

  try {
    const pipeline = redis.pipeline();
    pipeline.incr(failKey(name));
    pipeline.expire(failKey(name), config.windowSec);
    const [count] = (await pipeline.exec()) as [number, number];

    if (count >= config.failureThreshold) {
      await setState(name, 'OPEN', config.resetTimeoutSec);
      logger.warn('circuit.opened', {
        circuit: name,
        fail_count: count,
        threshold: config.failureThreshold,
      });
    }
  } catch (err) {
    logger.warn('circuit.record_failure_redis_error', {
      circuit: name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Wrap 1 async function với circuit breaker.
 *
 * @param name - Tên circuit unique (vd "llm:anthropic:sonnet-4-6").
 * @param fn - Function thực sự call provider.
 * @param config - Override default config.
 * @returns Result của fn nếu CLOSED/HALF_OPEN success.
 * @throws CircuitOpenError nếu OPEN, hoặc lỗi gốc từ fn.
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  config: Partial<CircuitConfig> = {},
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const state = await getState(name);

  if (state === 'OPEN') {
    // Hết TTL → Redis sẽ del → next call sẽ thấy CLOSED.
    // Trong window OPEN: deny ngay (fail fast).
    throw new CircuitOpenError(`Circuit ${name} đang OPEN`);
  }

  if (state === 'HALF_OPEN') {
    const got = await acquireProbe(name);
    if (!got) {
      // Instance khác đang probe — deny để tránh dồn tải
      throw new CircuitOpenError(`Circuit ${name} HALF_OPEN, instance khác đang probe`);
    }
  }

  try {
    const result = await fn();
    await recordSuccess(name, state);
    return result;
  } catch (err) {
    await recordFailure(name, state, cfg);
    throw err;
  }
}

/**
 * Class error riêng để caller distinguish "circuit open" vs "underlying error".
 * Caller có thể catch CircuitOpenError → thử fallback provider.
 */
export class CircuitOpenError extends Error {
  override name = 'CircuitOpenError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Manual control — admin tool reset circuit (vd sau bug fix).
 */
export async function resetCircuit(name: string): Promise<void> {
  await setState(name, 'CLOSED');
}

/**
 * Liệt kê toàn bộ circuit hiện có trong Redis — dùng cho admin dashboard.
 *
 * Phase 3 admin: scan keys `cb:state:*` (chỉ circuit khác CLOSED có entry vì
 * setState xoá key khi CLOSED) + `cb:fail:*` (counter window). Merge thành 1
 * list. Circuit CLOSED hoàn toàn (không state + không fail count) sẽ KHÔNG
 * xuất hiện — vì Redis không có dấu vết của nó.
 *
 * Để tracking đầy đủ "all known circuits", Phase 3.1 sẽ thêm 1 Redis SET riêng
 * push tên mỗi lần withCircuitBreaker chạy. Hiện tại chỉ show các circuit
 * "non-healthy" hoặc đang có fail recent — đủ để ops monitor.
 */
export async function listCircuits(): Promise<
  Array<{
    name: string;
    state: CircuitState;
    failCount: number;
    /** TTL còn lại trên state key (giây) — biết khi nào HALF_OPEN. -1 nếu không có TTL. */
    stateTtl: number;
  }>
> {
  const redis = getRedis();
  try {
    const [stateKeys, failKeys] = await Promise.all([
      scanKeys(redis, 'cb:state:*'),
      scanKeys(redis, 'cb:fail:*'),
    ]);

    // Merge unique circuit names
    const names = new Set<string>();
    for (const k of stateKeys) names.add(k.slice('cb:state:'.length));
    for (const k of failKeys) names.add(k.slice('cb:fail:'.length));

    if (names.size === 0) return [];

    const sortedNames = Array.from(names).sort();
    const results = await Promise.all(
      sortedNames.map(async (name) => {
        const [state, failRaw, ttl] = await Promise.all([
          getState(name),
          redis.get(failKey(name)),
          // Upstash + ioredis đều support TTL; signature khác chút nhưng đều trả số
          (redis as unknown as { ttl: (k: string) => Promise<number> }).ttl(
            stateKey(name),
          ),
        ]);
        return {
          name,
          state,
          failCount: failRaw ? Number(failRaw) : 0,
          stateTtl: typeof ttl === 'number' ? ttl : -1,
        };
      }),
    );
    return results;
  } catch (err) {
    logger.error('circuit.list.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * SCAN abstraction — hỗ trợ cả Upstash Redis (SCAN cursor) và ioredis.
 * Trả về tối đa 1000 keys (đủ cho admin scope; provider list nhỏ).
 */
async function scanKeys(redis: unknown, pattern: string): Promise<string[]> {
  const r = redis as {
    scan: (cursor: string | number, opts: { match: string; count: number }) => Promise<[string, string[]] | { cursor: string; keys: string[] }>;
  };
  const all: string[] = [];
  let cursor: string | number = 0;
  for (let i = 0; i < 20; i++) {
    const res = await r.scan(cursor, { match: pattern, count: 100 });
    // Upstash trả { cursor, keys }; ioredis trả [cursor, keys]
    if (Array.isArray(res)) {
      cursor = res[0];
      all.push(...res[1]);
    } else {
      cursor = res.cursor;
      all.push(...res.keys);
    }
    if (String(cursor) === '0') break;
    if (all.length > 1000) break;
  }
  return all;
}

/**
 * Inspect state — dashboard.
 */
export async function getCircuitState(
  name: string,
): Promise<{ state: CircuitState; failCount: number }> {
  const redis = getRedis();
  const [state, failRaw] = await Promise.all([
    getState(name),
    redis.get(failKey(name)).catch(() => null),
  ]);
  return { state, failCount: failRaw ? Number(failRaw) : 0 };
}
