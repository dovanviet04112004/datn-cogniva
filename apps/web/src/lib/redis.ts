/**
 * Redis client — 3 implementation theo env, expose interface giống nhau.
 *
 * Pick logic (priority cao xuống thấp):
 *   1. REDIS_URL  → ioredis (TCP) — dùng cho dev local Docker (redis://localhost:6379)
 *   2. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN → @upstash/redis (REST) —
 *      dùng cho Vercel production (serverless cần HTTP REST vì TCP socket
 *      không persist giữa cold start)
 *   3. Không có gì → InMemoryRedis fallback (dev/test, không share giữa process)
 *
 * Vì sao 2 implementation:
 *   - Production Vercel: Upstash REST chạy ở edge runtime, không cần connection
 *     pool, mỗi command 1 HTTP request idempotent
 *   - Dev local: muốn tận dụng Redis Docker đã chạy cho LiveKit/Soketi pub/sub,
 *     ioredis nhanh hơn ~10ms vs REST khi cùng máy
 *   - Production Hetzner (Stage 3): có thể self-host DragonflyDB qua ioredis
 *     compat → switch sang ioredis path bằng cách set REDIS_URL
 *
 * Adapter pattern: cả 3 client đều expose subset:
 *   get / set { ex?, nx?, px? } / incr / incrby / expire / del / ttl / pipeline
 * Code caller (rate-limit, circuit-breaker, semantic-cache) KHÔNG biết implementation.
 */
import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis from 'ioredis';

export type RedisClient = UpstashRedis | InMemoryRedis | IoRedisAdapter;

let _client: RedisClient | null = null;
let _devWarned = false;

/**
 * Lấy Redis client. Singleton — Vercel function instance tái dùng giữa các
 * cold start cùng container; dev Node process tái dùng cả lifecycle.
 */
export function getRedis(): RedisClient {
  if (_client) return _client;

  // Priority 1: ioredis qua REDIS_URL (dev local Docker)
  const tcpUrl = process.env.REDIS_URL;
  if (tcpUrl) {
    _client = new IoRedisAdapter(tcpUrl);
    return _client;
  }

  // Priority 2: Upstash REST (production serverless)
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    _client = new UpstashRedis({
      url,
      token,
      retry: { retries: 2, backoff: (i) => Math.min(1000 * Math.pow(2, i), 5000) },
    });
    return _client;
  }

  // Priority 3: in-memory fallback
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[redis] Cần REDIS_URL hoặc UPSTASH_REDIS_REST_URL+TOKEN trong production. ' +
        'Fallback in-memory KHÔNG share giữa instance, rate limit sẽ bypass-able.',
    );
  }
  if (!_devWarned) {
    console.warn(
      '[redis] Dùng in-memory fallback (REDIS_URL + UPSTASH env trống). Chỉ OK dev/test.',
    );
    _devWarned = true;
  }
  _client = new InMemoryRedis();
  return _client;
}

// ──────────────────────────────────────────────────────────
// IoRedisAdapter — wrap ioredis TCP client thành Upstash API shape
// ──────────────────────────────────────────────────────────
/**
 * Adapter giúp `ioredis` expose API giống `@upstash/redis` để caller (rate-limit,
 * circuit-breaker, semantic-cache) KHÔNG phải branch theo provider.
 *
 * Khác biệt chính cần dịch:
 *   - set: ioredis dùng args `'EX', sec` / `'NX'` / `'PX', ms` (variadic),
 *     Upstash dùng object `{ ex, nx, px }`
 *   - pipeline.exec(): ioredis trả `[[err, result], ...]` (Redis convention),
 *     Upstash trả `[result, result, ...]` — strip err để match
 *   - eval: ioredis nhận `script, numkeys, ...keys, ...args` (variadic),
 *     Upstash nhận `script, keys[], args[]` — wrap args
 */
export class IoRedisAdapter {
  private client: IORedis;

  constructor(url: string) {
    this.client = new IORedis(url, {
      // Lazy connect — không block startup nếu Redis chưa up. Connection tạo
      // ở first command, retry tự động.
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      // Reconnect khi network drop
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });
    // Tắt log noisy "connection refused" — caller fail-open đã handle
    this.client.on('error', (err: unknown) => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[redis/ioredis] connection error:', err instanceof Error ? err.message : err);
      }
    });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /**
   * SET với options. Map Upstash style `{ ex, nx, px }` → ioredis variadic.
   * Lưu ý ioredis trả 'OK' khi success, null khi NX fail (cùng Upstash).
   */
  async set(
    key: string,
    value: string | number,
    opts?: { ex?: number; nx?: boolean; px?: number },
  ): Promise<'OK' | null> {
    const args: (string | number)[] = [];
    if (opts?.ex) args.push('EX', opts.ex);
    if (opts?.px) args.push('PX', opts.px);
    if (opts?.nx) args.push('NX');
    // ioredis typing complicates variadic — cast về any-side để pass-through
    const v = typeof value === 'number' ? value.toString() : value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (this.client.set as any)(key, v, ...args);
    return (result as 'OK' | null) ?? null;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async incrby(key: string, amount: number): Promise<number> {
    return this.client.incrby(key, amount);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * EVAL Lua — ioredis: `eval(script, numkeys, ...keys, ...args)`;
   * Upstash: `eval(script, keys: string[], args: string[])`.
   */
  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    return this.client.eval(script, keys.length, ...keys, ...args);
  }

  /**
   * Pipeline — execute commands trên cùng connection.
   * exec() strip err prefix `[[err, result], ...]` → `[result, ...]` để khớp Upstash.
   */
  pipeline() {
    const pl = this.client.pipeline();
    const chainable = {
      get(key: string) {
        pl.get(key);
        return chainable;
      },
      set(key: string, value: string | number, opts?: { ex?: number }) {
        if (opts?.ex) pl.set(key, String(value), 'EX', opts.ex);
        else pl.set(key, String(value));
        return chainable;
      },
      incr(key: string) {
        pl.incr(key);
        return chainable;
      },
      incrby(key: string, amount: number) {
        pl.incrby(key, amount);
        return chainable;
      },
      expire(key: string, sec: number) {
        pl.expire(key, sec);
        return chainable;
      },
      del(key: string) {
        pl.del(key);
        return chainable;
      },
      async exec(): Promise<unknown[]> {
        const results = await pl.exec();
        if (!results) return [];
        // ioredis trả [[Error|null, result], ...] → strip err, return only results.
        // Throw nếu có command fail (giống cách Upstash báo lỗi qua reject promise).
        return results.map(([err, result]) => {
          if (err) throw err;
          return result;
        });
      },
    };
    return chainable;
  }

  /** Cleanup — gọi khi process exit. Singleton nên rarely needed. */
  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}

// ──────────────────────────────────────────────────────────
// InMemoryRedis — fallback minimal cho dev/test khi không có Redis
// ──────────────────────────────────────────────────────────
/**
 * InMemoryRedis — implement subset Redis API ta dùng:
 *   get / set với EX/NX/PX, incr / incrby, expire, del, ttl, pipeline.
 *
 * KHÔNG share giữa Node process. Reset khi server restart. KHÔNG production.
 */
export class InMemoryRedis {
  private store = new Map<string, { value: string; expireAt: number | null }>();

  private isExpired(entry: { expireAt: number | null }): boolean {
    return entry.expireAt !== null && entry.expireAt < Date.now();
  }

  private cleanExpired(key: string): void {
    const entry = this.store.get(key);
    if (entry && this.isExpired(entry)) this.store.delete(key);
  }

  async get(key: string): Promise<string | null> {
    this.cleanExpired(key);
    return this.store.get(key)?.value ?? null;
  }

  async set(
    key: string,
    value: string | number,
    opts?: { ex?: number; nx?: boolean; px?: number },
  ): Promise<'OK' | null> {
    this.cleanExpired(key);
    if (opts?.nx && this.store.has(key)) return null;
    const ttlMs = opts?.ex ? opts.ex * 1000 : opts?.px;
    this.store.set(key, {
      value: String(value),
      expireAt: ttlMs ? Date.now() + ttlMs : null,
    });
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    return this.incrby(key, 1);
  }

  async incrby(key: string, amount: number): Promise<number> {
    this.cleanExpired(key);
    const entry = this.store.get(key);
    const current = entry ? Number(entry.value) : 0;
    const next = current + amount;
    this.store.set(key, { value: String(next), expireAt: entry?.expireAt ?? null });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expireAt = Date.now() + seconds * 1000;
    return 1;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) deleted++;
    }
    return deleted;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.expireAt === null) return -1;
    return Math.max(0, Math.floor((entry.expireAt - Date.now()) / 1000));
  }

  /** Eval Lua — InMemory không hỗ trợ. Caller phải fallback path. */
  async eval(_script: string, _keys: string[], _args: string[]): Promise<unknown> {
    throw new Error('[InMemoryRedis] eval() chưa implement — set REDIS_URL hoặc UPSTASH_*');
  }

  pipeline() {
    const commands: Array<() => Promise<unknown>> = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const redis = this;
    const chainable = {
      get(key: string) {
        commands.push(() => redis.get(key));
        return chainable;
      },
      set(key: string, value: string | number, opts?: { ex?: number }) {
        commands.push(() => redis.set(key, value, opts));
        return chainable;
      },
      incr(key: string) {
        commands.push(() => redis.incr(key));
        return chainable;
      },
      incrby(key: string, amount: number) {
        commands.push(() => redis.incrby(key, amount));
        return chainable;
      },
      expire(key: string, sec: number) {
        commands.push(() => redis.expire(key, sec));
        return chainable;
      },
      del(key: string) {
        commands.push(() => redis.del(key));
        return chainable;
      },
      async exec() {
        const results: unknown[] = [];
        for (const cmd of commands) results.push(await cmd());
        return results;
      },
    };
    return chainable;
  }
}

/**
 * Check Redis health — gọi từ /api/health.
 * Trả về { ok, latencyMs, mode: 'redis-tcp' | 'redis-rest' | 'inmemory' }.
 */
export async function checkRedisHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  mode: 'redis-tcp' | 'redis-rest' | 'inmemory';
  error?: string;
}> {
  const redis = getRedis();
  let mode: 'redis-tcp' | 'redis-rest' | 'inmemory';
  if (redis instanceof InMemoryRedis) mode = 'inmemory';
  else if (redis instanceof IoRedisAdapter) mode = 'redis-tcp';
  else mode = 'redis-rest';

  const start = Date.now();
  try {
    await redis.set('health:ping', String(Date.now()), { ex: 60 });
    const val = await redis.get('health:ping');
    return {
      ok: val !== null,
      latencyMs: Date.now() - start,
      mode,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      mode,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
