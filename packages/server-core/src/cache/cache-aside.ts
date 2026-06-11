import { getRedis } from '../redis';
import { logger } from '../logger';

export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();

  try {
    const hit: unknown = await redis.get(key);
    if (hit !== null && hit !== undefined) {
      return (typeof hit === 'string' ? JSON.parse(hit) : hit) as T;
    }
  } catch (err) {
    logger.warn('cache.read_error', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const data = await fn();

  try {
    await redis.set(key, JSON.stringify(data), { ex: ttlSec });
  } catch (err) {
    logger.warn('cache.write_error', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return data;
}

export async function cacheDelete(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await getRedis().del(...keys);
  } catch (err) {
    logger.warn('cache.del_error', {
      keys,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function cacheVersion(tag: string): Promise<number> {
  try {
    const v: unknown = await getRedis().get(`ver:${tag}`);
    const n = v === null || v === undefined ? NaN : Number(v);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

export async function bumpCacheVersion(tag: string): Promise<void> {
  try {
    await getRedis().incr(`ver:${tag}`);
  } catch (err) {
    logger.warn('cache.bump_error', {
      tag,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
