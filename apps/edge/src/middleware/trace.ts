/**
 * Trace middleware — set trace id vào Hono context + response header,
 * forward sang origin để correlate edge log ↔ Next.js log ↔ Sentry.
 */
import type { MiddlewareHandler } from 'hono';

import type { HonoEnv } from '../env';
import { getOrCreateTraceId } from '../lib/trace';

export function traceMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const traceId = getOrCreateTraceId(c.req.raw);
    c.set('traceId', traceId);
    c.header('x-trace-id', traceId);
    return next();
  };
}
