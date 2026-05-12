/**
 * @cogniva/edge — Cloudflare Workers gateway entry point.
 *
 * Request lifecycle:
 *   1. trace          → set trace id
 *   2. geo            → set country + region từ CF header
 *   3. jwtVerify      → đọc JWT (cookie hoặc Bearer), set userId
 *   4. csrf           → double-submit cookie pattern cho mutating methods
 *   5. rateLimit      → token bucket per (userId | IP) qua Durable Object
 *   6. featureFlags   → eval flags từ KV, set x-cogniva-flags header
 *   7. proxyToOrigin  → forward tới Vercel với headers enriched
 *
 * Health check: GET /__edge/health → bypass guard, trả uptime + region tag.
 *
 * Export `RateLimitDO` để Workers runtime register class với migration v1.
 */
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

// ── Global middleware (theo thứ tự ưu tiên) ─────────────────────────
app.use('*', traceMiddleware());
app.use('*', geoMiddleware());

// Health endpoint — bypass auth/rate/csrf để uptime check không bị block.
// Cloudflare load balancer + Better Stack ping endpoint này.
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

// Auth-related public route — Better Auth tự xử CSRF nội bộ.
// CHÚ Ý: KHÔNG verify JWT ở đây vì /sign-in chưa có session.
app.all('/api/auth/*', async (c) => {
  return proxyToOrigin(c);
});

// ── Authenticated/sensitive path — full guard ───────────────────────
app.use('*', jwtVerifyMiddleware());
app.use('*', csrf());
app.use('*', rateLimit());
app.use('*', featureFlags());

// Catchall — forward mọi path còn lại về origin.
app.all('*', async (c) => {
  return proxyToOrigin(c);
});

// Global error handler — log + return 500 (KHÔNG leak stacktrace).
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
