import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis, { type RedisOptions } from 'ioredis';

export type RedisClient = UpstashRedis | InMemoryRedis | IoRedisAdapter;

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

export function getRedis(): RedisClient {
  if (_client) return _client;

  const tcpUrl = process.env.REDIS_URL;
  if (tcpUrl) {
    _client = new IoRedisAdapter(tcpUrl);
    return _client;
  }

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

export class IoRedisAdapter {
  private client: IORedis;

  constructor(url: string) {
    const parsed = redisOptionsFromUrl(url);
    const common: RedisOptions = {
      lazyConnect: false,
      commandTimeout: 2000,
      connectTimeout: 2000,
      maxRetriesPerRequest: 2,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    };
    this.client =
      typeof parsed === 'string'
        ? new IORedis(parsed, common)
        : new IORedis({ ...parsed, ...common });
    this.client.on('error', (err: unknown) => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[redis/ioredis] connection error:', err instanceof Error ? err.message : err);
      }
    });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(
    key: string,
    value: string | number,
    opts?: { ex?: number; nx?: boolean; px?: number },
  ): Promise<'OK' | null> {
    const args: (string | number)[] = [];
    if (opts?.ex) args.push('EX', opts.ex);
    if (opts?.px) args.push('PX', opts.px);
    if (opts?.nx) args.push('NX');
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

  async zincrby(key: string, increment: number, member: string): Promise<number> {
    const v = await this.client.zincrby(key, increment, member);
    return Number(v);
  }

  async zrevrange(
    key: string,
    start: number,
    stop: number,
    withScores: boolean,
  ): Promise<string[]> {
    if (withScores) {
      return this.client.zrevrange(key, start, stop, 'WITHSCORES');
    }
    return this.client.zrevrange(key, start, stop);
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    const v = await this.client.zrevrank(key, member);
    return v ?? null;
  }

  async zscore(key: string, member: string): Promise<number | null> {
    const v = await this.client.zscore(key, member);
    return v === null ? null : Number(v);
  }

  async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.zrem(key, ...members);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.sadd(key, ...members);
  }
  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.srem(key, ...members);
  }
  async scard(key: string): Promise<number> {
    return this.client.scard(key);
  }
  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    return this.client.eval(script, keys.length, ...keys, ...args);
  }

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
        return results.map(([err, result]) => {
          if (err) throw err;
          return result;
        });
      },
    };
    return chainable;
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}

export class InMemoryRedis {
  private store = new Map<string, { value: string; expireAt: number | null }>();
  private zsets = new Map<string, Map<string, number>>();
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

  async eval(_script: string, _keys: string[], _args: string[]): Promise<unknown> {
    throw new Error('[InMemoryRedis] eval() chưa implement — set REDIS_URL hoặc UPSTASH_*');
  }

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

  async zrevrange(
    key: string,
    start: number,
    stop: number,
    withScores: boolean,
  ): Promise<string[]> {
    const zset = this.zsets.get(key);
    if (!zset) return [];
    const sorted = [...zset.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
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

export async function zRevRangeWithScores(key: string, n: number): Promise<string[]> {
  if (n <= 0) return [];
  const r = getRedis();
  if (r instanceof IoRedisAdapter || r instanceof InMemoryRedis) {
    return r.zrevrange(key, 0, n - 1, true);
  }
  const flat = (await r.zrange(key, 0, n - 1, { rev: true, withScores: true })) as unknown[];
  return flat.map((v) => String(v));
}
