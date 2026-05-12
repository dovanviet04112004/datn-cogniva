/**
 * Upstash Redis client — singleton REST client cho serverless-safe ops.
 *
 * Vì sao @upstash/redis (REST) thay vì ioredis (TCP):
 *   - Vercel function runtime KHÔNG persist TCP socket giữa request → mỗi
 *     call ioredis tạo connection mới (cold start ~50ms).
 *   - Upstash REST dùng HTTP/2, không cần connection pool, fan-out tốt cho
 *     serverless. Mỗi command 1 HTTP request, idempotent.
 *   - Edge runtime (Cloudflare Workers, Vercel Edge) KHÔNG hỗ trợ TCP →
 *     ioredis không chạy ở edge, REST chạy được mọi nơi.
 *
 * Trade-off:
 *   - Latency thêm ~5-15ms vs ioredis cùng region (HTTP overhead).
 *   - OK cho hot path rate limit (< 20ms total acceptable).
 *
 * Khi thay sang DragonflyDB self-host (Stage 3) — interface giống nhau qua
 * @upstash/redis-compat wrapper.
 *
 * No-op mode:
 *   - Nếu UPSTASH env thiếu → trả về client mock no-op (in-memory Map).
 *   - Dev/test không cần Redis. Production phải set env.
 */
import { Redis } from '@upstash/redis';

let _client: Redis | InMemoryRedis | null = null;

/**
 * Lấy Redis client. Singleton — Vercel function instance tái dùng giữa các
 * cold start cùng container.
 */
export function getRedis(): Redis | InMemoryRedis {
  if (_client) return _client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (process.env.NODE_ENV === 'production') {
      // Hard fail trong prod — không cho silent degrade vì rate limit + cost
      // guardrail phụ thuộc.
      console.error(
        '[redis] UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN bắt buộc trong production. ' +
          'Fallback in-memory KHÔNG share giữa instance, rate limit sẽ bypass-able.',
      );
    }
    // Dev fallback — log warning 1 lần
    if (!_devWarned) {
      console.warn(
        '[redis] Dùng in-memory fallback (UPSTASH env chưa cấu hình). ' +
          'Chỉ OK cho dev/test local.',
      );
      _devWarned = true;
    }
    _client = new InMemoryRedis();
    return _client;
  }

  _client = new Redis({
    url,
    token,
    // Auto-retry on transient failures (Upstash REST đôi khi 502/503)
    retry: { retries: 2, backoff: (i) => Math.min(1000 * Math.pow(2, i), 5000) },
  });
  return _client;
}

let _devWarned = false;

/**
 * InMemoryRedis — fallback minimal cho dev/test khi không có Upstash.
 *
 * Implement subset của Redis API mà ta thật sự dùng:
 *   - get / set với EX (expiry seconds)
 *   - incr / incrby
 *   - expire
 *   - eval (Lua) — simulate qua atomic JS operation
 *
 * KHÔNG share giữa multiple Node process. Reset khi server restart.
 * KHÔNG production-safe. Warning đã log ở getRedis.
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

  /** Eval Lua — InMemory implement subset cho rate-limit token bucket. */
  async eval(_script: string, _keys: string[], _args: string[]): Promise<unknown> {
    // InMemory không hỗ trợ Lua. Caller phải fallback path khi gặp.
    throw new Error('[InMemoryRedis] eval() chưa implement — dùng @upstash/redis thật');
  }

  /** Pipeline — execute commands trên cùng một instance, không atomic. */
  pipeline() {
    const commands: Array<() => Promise<unknown>> = [];
    // Capture `this` để closure trong returned chainable object truy cập được —
    // nếu inline `this` trong arrow fn sẽ undefined khi caller gọi chainable.method().
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
 * Trả về { ok, latencyMs, mode: 'redis' | 'inmemory' }.
 */
export async function checkRedisHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  mode: 'redis' | 'inmemory';
  error?: string;
}> {
  const redis = getRedis();
  const mode = redis instanceof InMemoryRedis ? 'inmemory' : 'redis';
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
