import { getRedis } from './redis';
import { logger } from './logger';

export type RateLimitConfig = {
  capacity: number;
  windowMs: number;
};

export const PRESET_LIMITS = {
  chat: { capacity: 30, windowMs: 60_000 },
  aiGenerate: { capacity: 10, windowMs: 60_000 },
  upload: { capacity: 20, windowMs: 60_000 },
  default: { capacity: 60, windowMs: 60_000 },
  auth: { capacity: 10, windowMs: 60_000 },
  realtimeAuth: { capacity: 60, windowMs: 60_000 },
} as const;

export type LimitName = keyof typeof PRESET_LIMITS;

export type LimitResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; remaining: 0; resetAt: number; retryAfter: number };

export async function checkLimit(key: string, preset: LimitName): Promise<LimitResult> {
  const config = PRESET_LIMITS[preset];
  return checkLimitCustom(key, config, preset);
}

export async function checkLimitCustom(
  key: string,
  config: RateLimitConfig,
  presetTag = 'custom',
): Promise<LimitResult> {
  const redis = getRedis();
  const windowSec = Math.ceil(config.windowMs / 1000);
  const rk = `rl:${presetTag}:${key}`;

  try {
    const pipeline = redis.pipeline();
    pipeline.incr(rk);
    pipeline.expire(rk, windowSec);
    const [count] = (await pipeline.exec()) as [number, number];

    if (count > config.capacity) {
      const ttl = await redis.ttl(rk);
      const retryAfter = ttl > 0 ? ttl : windowSec;
      return {
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + retryAfter * 1000,
        retryAfter,
      };
    }

    return {
      allowed: true,
      remaining: config.capacity - count,
      resetAt: Date.now() + windowSec * 1000,
    };
  } catch (err) {
    logger.warn('ratelimit.redis_error', {
      key: rk,
      preset: presetTag,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      allowed: true,
      remaining: config.capacity,
      resetAt: Date.now() + config.windowMs,
    };
  }
}

export async function resetLimit(key: string, preset: LimitName): Promise<void> {
  const redis = getRedis();
  const rk = `rl:${preset}:${key}`;
  await redis.del(rk);
}

export async function consume(
  key: string,
  limit: RateLimitConfig,
  _cost = 1,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const result = await checkLimitCustom(key, limit);
  if (result.allowed) return { ok: true };
  return { ok: false, retryAfter: result.retryAfter };
}

export function purgeOldBuckets(_olderThanMs?: number): void {}
