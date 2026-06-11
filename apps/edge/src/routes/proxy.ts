import type { Context } from 'hono';

import type { HonoEnv } from '../env';
import { logger } from '../lib/logger';

export async function proxyToOrigin(c: Context<HonoEnv>): Promise<Response> {
  const reqUrl = new URL(c.req.url);
  const origin = new URL(c.env.ORIGIN_URL);

  const targetUrl = new URL(reqUrl.pathname + reqUrl.search, origin);

  const fwd = new Headers(c.req.raw.headers);
  fwd.set('host', origin.host);
  fwd.set('x-trace-id', c.get('traceId'));
  fwd.set('x-cogniva-country', c.get('country') ?? 'XX');
  fwd.set('x-cogniva-region', c.get('region'));

  const userId = c.get('userId');
  if (userId) fwd.set('x-cogniva-user-id', userId);
  else fwd.delete('x-cogniva-user-id');

  if (c.env.EDGE_SHARED_SECRET) {
    fwd.set('x-edge-verified', c.env.EDGE_SHARED_SECRET);
  }

  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetch(targetUrl.toString(), {
      method: c.req.method,
      headers: fwd,
      body: c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : c.req.raw.body,
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
