/**
 * Proxy route — forward request đã qua guard tới origin Vercel.
 *
 * Forward strategy:
 *   - Rewrite URL: thay host = ORIGIN_URL, giữ pathname + query
 *   - Forward toàn bộ header, thêm:
 *       x-trace-id           (correlate)
 *       x-cogniva-user-id    (edge đã verify JWT, origin trust)
 *       x-cogniva-country
 *       x-cogniva-region
 *       x-cogniva-flags
 *       x-edge-verified      (EDGE_SHARED_SECRET — chống bypass edge)
 *   - Forward body với streaming (Workers fetch tự stream)
 *   - Return response từ origin nguyên vẹn
 *
 * Streaming: response body từ origin = ReadableStream → Workers stream tiếp
 * về client KHÔNG buffer. AI streaming, SSE work bình thường.
 *
 * Timeout: Workers max subrequest 30s (free) / 5min (paid). AI streaming
 * có thể > 30s — phải dùng paid plan hoặc bypass edge cho /api/chat.
 */
import type { Context } from 'hono';

import type { HonoEnv } from '../env';
import { logger } from '../lib/logger';

export async function proxyToOrigin(c: Context<HonoEnv>): Promise<Response> {
  const reqUrl = new URL(c.req.url);
  const origin = new URL(c.env.ORIGIN_URL);

  // Build forward URL: origin + path + query
  const targetUrl = new URL(reqUrl.pathname + reqUrl.search, origin);

  // Build forward headers
  const fwd = new Headers(c.req.raw.headers);
  fwd.set('host', origin.host);
  fwd.set('x-trace-id', c.get('traceId'));
  fwd.set('x-cogniva-country', c.get('country') ?? 'XX');
  fwd.set('x-cogniva-region', c.get('region'));

  const userId = c.get('userId');
  if (userId) fwd.set('x-cogniva-user-id', userId);
  else fwd.delete('x-cogniva-user-id'); // chống client tự forge

  // Edge-verified marker để origin biết request đã qua edge guard (anti-bypass).
  if (c.env.EDGE_SHARED_SECRET) {
    fwd.set('x-edge-verified', c.env.EDGE_SHARED_SECRET);
  }

  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetch(targetUrl.toString(), {
      method: c.req.method,
      headers: fwd,
      body:
        c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : c.req.raw.body,
      // @ts-expect-error: Workers fetch hỗ trợ duplex: 'half' cho body stream
      duplex: 'half',
      redirect: 'manual',
    });
  } catch (err) {
    logger.error('proxy.origin_unreachable', {
      trace_id: c.get('traceId'),
      target: targetUrl.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json(
      {
        error: 'bad_gateway',
        message: 'Origin server không phản hồi. Thử lại sau.',
      },
      502,
    );
  }

  const dt = Date.now() - t0;
  logger.info('proxy.forwarded', {
    trace_id: c.get('traceId'),
    method: c.req.method,
    path: reqUrl.pathname,
    status: response.status,
    duration_ms: dt,
    user_id: userId,
    region: c.get('region'),
  });

  // Strip header riêng của origin có thể leak info (server tech, x-powered-by).
  const respHeaders = new Headers(response.headers);
  respHeaders.delete('x-powered-by');
  respHeaders.delete('server');
  respHeaders.set('x-edge-duration-ms', String(dt));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: respHeaders,
  });
}
