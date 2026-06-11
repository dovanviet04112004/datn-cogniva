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
