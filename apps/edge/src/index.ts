import { Hono } from 'hono';

import type { HonoEnv } from './env';
import { logger } from './lib/logger';
import { traceMiddleware } from './middleware/trace';
import { geoMiddleware } from './middleware/geo';
import { jwtVerifyMiddleware } from './middleware/jwt-verify';
import { csrf } from './middleware/csrf';
import { rateLimit } from './middleware/rate-limit';
import { featureFlags } from './middleware/feature-flags';
import { proxyToOrigin } from './routes/proxy';

export { RateLimitDO } from './do/rate-limit-do';

const app = new Hono<HonoEnv>();

app.use('*', traceMiddleware());
app.use('*', geoMiddleware());

app.get('/__edge/health', (c) => {
  return c.json({
    ok: true,
    env: c.env.ENV,
    region: c.get('region'),
    country: c.get('country'),
    trace_id: c.get('traceId'),
    ts: new Date().toISOString(),
  });
});

app.all('/api/auth/*', async (c) => {
  return proxyToOrigin(c);
});

app.use('*', jwtVerifyMiddleware());
app.use('*', csrf());
app.use('*', rateLimit());
app.use('*', featureFlags());

app.all('*', async (c) => {
  return proxyToOrigin(c);
});

app.onError((err, c) => {
  logger.error('edge.unhandled', {
    trace_id: c.get('traceId'),
    path: new URL(c.req.url).pathname,
    error: err.message,
    stack: err.stack,
  });
  return c.json(
    {
      error: 'internal_error',
      message: 'Edge error. Vui lòng thử lại.',
      trace_id: c.get('traceId'),
    },
    500,
  );
});

export default app;
