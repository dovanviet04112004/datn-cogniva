import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, errors } from 'jose';

import type { HonoEnv } from '../env';
import { logger } from '../lib/logger';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJWKS(url: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 60 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
    jwksCache.set(url, jwks);
  }
  return jwks;
}

function extractJwt(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'cg_at' || k === '__Secure-cg_at') {
      return rest.join('=');
    }
  }
  return null;
}

export function jwtVerifyMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const token = extractJwt(c.req.raw);
    if (!token) {
      c.set('userId', null);
      c.set('isAuthenticated', false);
      return next();
    }

    try {
      const jwks = getJWKS(c.env.JWKS_URL);
      const { payload } = await jwtVerify(token, jwks, {
        issuer: c.env.JWT_ISSUER,
        audience: c.env.JWT_AUDIENCE,
      });

      const userId = typeof payload.sub === 'string' ? payload.sub : null;
      c.set('userId', userId);
      c.set('isAuthenticated', !!userId);
    } catch (err) {
      const reason =
        err instanceof errors.JOSEError ? err.code : err instanceof Error ? err.message : 'unknown';
      logger.debug('jwt.verify_failed', {
        trace_id: c.get('traceId'),
        reason,
      });
      c.set('userId', null);
      c.set('isAuthenticated', false);
    }

    return next();
  };
}
