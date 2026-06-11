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
 *   - Dev local: muốn tận dụng Redis Docker đã chạy cho LiveKit/Socket.IO pub/sub,
 *     ioredis nhanh hơn ~10ms vs REST khi cùng máy
 *   - Production Hetzner (Stage 3): có thể self-host DragonflyDB qua ioredis
 *     compat → switch sang ioredis path bằng cách set REDIS_URL
 *
 * Adapter pattern: cả 3 client đều expose subset:
 *   get / set { ex?, nx?, px? } / incr / incrby / expire / del / ttl / pipeline
 * Code caller (rate-limit, circuit-breaker, semantic-cache) KHÔNG biết implementation.
 */
import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis, { type RedisOptions } from 'ioredis';

export type RedisClient = UpstashRedis | InMemoryRedis | IoRedisAdapter;

/**
 * Parse REDIS_URL bằng WHATWG URL → options object cho ioredis. Truyền chuỗi
 * URL thẳng vào `new IORedis(url)` sẽ đi qua parseURL nội bộ dùng
 * `url.parse()` — Node ≥24 phát DeprecationWarning DEP0169 và Next dev
 * overlay hiển thị thành Console Error ở lần SSR đầu chạm Redis.
 * URL dị dạng → fallback trả nguyên chuỗi (đường cũ, chấp nhận warning).
 */
export function redisOptionsFromUrl(url: string): RedisOptions | string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') return url;
    const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined;
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 6379,
      ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
      ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
      ...(db !== undefined && Number.isInteger(db) ? { db } : {}),
      ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    };
  } catch {
    return url;
  }
}

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
    const parsed = redisOptionsFromUrl(url);
    const common: RedisOptions = {
      // Lazy connect — không block startup nếu Redis chưa up. Connection tạo
      // ở first command, retry tự động.
      lazyConnect: false,
      // ── Cân bằng: IM khi bình thường + fail-open có GIỚI HẠN khi Redis chết ──
      // GIỮ enableOfflineQueue=true (mặc định): connection chưa sẵn (startup/HMR/reconnect
      // blip) → command XẾP HÀNG chờ thay vì fail ngay → KHÔNG spam "Stream isn't writeable".
      // `commandTimeout` cap: Redis thực sự DOWN → command fail trong ~2s (fail-open → DB)
      // thay vì treo 20s (root: connectTimeout mặc định 10s × retry). connectTimeout ngắn +
      // maxRetriesPerRequest thấp để fail nhanh.
      commandTimeout: 2000,
      connectTimeout: 2000,
      maxRetriesPerRequest: 2,
      // Reconnect khi network drop
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    };
    this.client =
      typeof parsed === 'string'
        ? new IORedis(parsed, common)
        : new IORedis({ ...parsed, ...common });
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

  // ── Sorted Set ops (Phase 17 leaderboard) ──────────────────
  /** ZINCRBY key inc member → trả về điểm mới sau khi tăng. */
  async zincrby(key: string, increment: number, member: string): Promise<number> {
    const v = await this.client.zincrby(key, increment, member);
    return Number(v);
  }

  /**
   * ZREVRANGE WITHSCORES — top N descending. Trả format flat `[member,score,...]`
   * giống Upstash để caller pair lại được.
   */
  async zrevrange(key: string, start: number, stop: number, withScores: boolean): Promise<string[]> {
    if (withScores) {
      return this.client.zrevrange(key, start, stop, 'WITHSCORES');
    }
    return this.client.zrevrange(key, start, stop);
  }

  /** ZREVRANK — rank 0-indexed (cao nhất = 0). Null nếu member không có. */
  async zrevrank(key: string, member: string): Promise<number | null> {
    const v = await this.client.zrevrank(key, member);
    return v ?? null;
  }

  /** ZSCORE — null nếu member không có. */
  async zscore(key: string, member: string): Promise<number | null> {
    const v = await this.client.zscore(key, member);
    return v === null ? null : Number(v);
  }

  /** ZCARD — số members trong sorted set. */
  async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  /** ZREM — xoá members. Trả về số removed. */
  async zrem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.zrem(key, ...members);
  }

  // ── Set ops (presence count: live exam joined users) ───────
  /** SADD — trả về số members mới thêm (đã có không count). */
  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.sadd(key, ...members);
  }
  /** SREM — trả về số members removed. */
  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.srem(key, ...members);
  }
  /** SCARD — số members hiện tại. */
  async scard(key: string): Promise<number> {
    return this.client.scard(key);
  }
  /** SMEMBERS — list members. */
  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
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
  /** Sorted set storage: key → Map<member, score>. */
  private zsets = new Map<string, Map<string, number>>();
  /** Plain set storage: key → Set<member>. */
  private sets = new Map<string, Set<string>>();

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
      // Del cover cả 3 namespace: string store, sorted set, plain set
      let hit = false;
      if (this.store.delete(key)) hit = true;
      if (this.zsets.delete(key)) hit = true;
      if (this.sets.delete(key)) hit = true;
      if (hit) deleted++;
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

  // ── Sorted Set ops (in-memory simulation) ───────────────────
  private getZset(key: string): Map<string, number> {
    let zset = this.zsets.get(key);
    if (!zset) {
      zset = new Map();
      this.zsets.set(key, zset);
    }
    return zset;
  }

  async zincrby(key: string, increment: number, member: string): Promise<number> {
    const zset = this.getZset(key);
    const next = (zset.get(member) ?? 0) + increment;
    zset.set(member, next);
    return next;
  }

  async zrevrange(key: string, start: number, stop: number, withScores: boolean): Promise<string[]> {
    const zset = this.zsets.get(key);
    if (!zset) return [];
    // Sort desc theo score, tiebreak theo member alphabetic ASC (giống Redis)
    const sorted = [...zset.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
    // Redis: stop -1 = last
    const sliceStop = stop === -1 ? sorted.length : stop + 1;
    const slice = sorted.slice(start, sliceStop);
    if (withScores) {
      return slice.flatMap(([m, s]) => [m, String(s)]);
    }
    return slice.map(([m]) => m);
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    const zset = this.zsets.get(key);
    if (!zset || !zset.has(member)) return null;
    const sorted = [...zset.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
    const idx = sorted.findIndex(([m]) => m === member);
    return idx < 0 ? null : idx;
  }

  async zscore(key: string, member: string): Promise<number | null> {
    const zset = this.zsets.get(key);
    return zset?.get(member) ?? null;
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const zset = this.zsets.get(key);
    if (!zset) return 0;
    let removed = 0;
    for (const m of members) {
      if (zset.delete(m)) removed++;
    }
    return removed;
  }

  // ── Set ops (in-memory simulation) ──────────────────────────
  private getSet(key: string): Set<string> {
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
    return set;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.getSet(key);
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    return removed;
  }

  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
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

/**
 * ZSET top-N giảm dần kèm score — PORTABLE qua cả 3 provider.
 *
 * Vì sao cần wrapper: `@upstash/redis` KHÔNG có `zrevrange` (chỉ `zrange`+`{rev}`),
 * còn IoRedisAdapter/InMemoryRedis chỉ có `zrevrange` (chưa `zrange`). Gọi thẳng
 * trên union → vỡ type/runtime. Branch theo instanceof để mỗi provider dùng API nó có.
 *
 * @returns flat `[member, score, member, score, ...]` (string) — caller pair lại.
 *          Lỗi để caller bắt (leaderboard.ts fail-open → null → fallback DB).
 */
export async function zRevRangeWithScores(key: string, n: number): Promise<string[]> {
  if (n <= 0) return [];
  const r = getRedis();
  if (r instanceof IoRedisAdapter || r instanceof InMemoryRedis) {
    return r.zrevrange(key, 0, n - 1, true);
  }
  // Còn lại = Upstash REST: zrange với rev + withScores → flat array.
  const flat = (await r.zrange(key, 0, n - 1, { rev: true, withScores: true })) as unknown[];
  return flat.map((v) => String(v));
}
