import type { MiddlewareHandler } from 'hono';

import type { HonoEnv } from '../env';
import type { RateLimitConfig, RateLimitResult } from '../do/rate-limit-do';
import { logger } from '../lib/logger';

interface Options {
  authenticated: RateLimitConfig;
  anonymous: RateLimitConfig;
}

const DEFAULTS: Options = {
  authenticated: { capacity: 60, refillPerSec: 2 },
  anonymous: { capacity: 15, refillPerSec: 0.5 },
};

function getRateLimitKey(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): {
  key: string;
  isAuth: boolean;
} {
  const userId = c.get('userId');
  if (userId) return { key: `user:${userId}`, isAuth: true };
  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  return { key: `ip:${ip}`, isAuth: false };
}

export function rateLimit(opts: Partial<Options> = {}): MiddlewareHandler<HonoEnv> {
  const cfg = { ...DEFAULTS, ...opts };
  return async (c, next) => {
    const { key, isAuth } = getRateLimitKey(c);
    const limitCfg = isAuth ? cfg.authenticated : cfg.anonymous;

    let result: RateLimitResult | null = null;
    try {
      const doId = c.env.RATE_LIMIT_DO.idFromName(key);
      const stub = c.env.RATE_LIMIT_DO.get(doId);
      const res = await stub.fetch('https://rate-limit-do/consume', {
        method: 'POST',
        body: JSON.stringify(limitCfg),
        headers: { 'content-type': 'application/json' },
      });
      result = (await res.json()) as RateLimitResult;
    } catch (err) {
      logger.warn('rate_limit.do_error', {
        trace_id: c.get('traceId'),
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return next();
    }

    c.header('X-RateLimit-Limit', String(limitCfg.capacity));
    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset', String(result.resetAt));

    if (!result.allowed) {
      c.header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      logger.info('rate_limit.blocked', {
        trace_id: c.get('traceId'),
        key,
        retry_after_ms: result.retryAfterMs,
      });
      return c.json(
        {
          error: 'rate_limit_exceeded',
          message: 'Bạn đang gửi quá nhiều request. Vui lòng thử lại sau.',
          retry_after_ms: result.retryAfterMs,
        },
        429,
      );
    }

    return next();
  };
}
