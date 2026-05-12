/**
 * JWT verify middleware — đọc session JWT từ cookie/header, verify chữ ký
 * qua JWKS endpoint của Better Auth, set userId vào Hono context.
 *
 * Tại sao verify ở edge:
 *   - Origin Vercel cold start + DB query session → 100-500ms
 *   - Edge verify chỉ HMAC/RSA verify → < 5ms (jose dùng Web Crypto)
 *   - Reject 401 sớm cho request expired/forged → giảm tải origin
 *
 * KHÔNG block request nếu JWT invalid/missing — chỉ set userId=null. Route
 * cần auth sẽ tự reject ở origin (Next.js getSession). Edge chỉ "trust hint".
 *
 * Cache JWKS: KV `flag:jwks` TTL 1h. Cập nhật KHI rotate key thì wipe key này.
 */
import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, errors } from 'jose';

import type { HonoEnv } from '../env';
import { logger } from '../lib/logger';

// JWKS cache toàn cục theo Worker isolate. Cold start sẽ refetch.
// jose tự cache nội bộ — chỉ cần singleton để tái dùng giữa request.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJWKS(url: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(url);
  if (!jwks) {
    // jose `createRemoteJWKSet` cache trong 30s (default) + refresh on miss.
    jwks = createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 60 * 60 * 1000,   // 1h
      cooldownDuration: 30 * 1000,   // 30s giữa các lần refetch
    });
    jwksCache.set(url, jwks);
  }
  return jwks;
}

/**
 * Tìm JWT trong request:
 *   1. Header `Authorization: Bearer <jwt>` (mobile, API client)
 *   2. Cookie `better-auth.session_token` (web browser)
 *
 * Better Auth JWT plugin set cookie tên `better-auth.session_token`. Format
 * khác với session token DB-backed — đây là JWT signed.
 */
function extractJwt(request: Request): string | null {
  // 1. Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  // 2. Cookie
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'better-auth.session_token' || k === '__Secure-better-auth.session_token') {
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

      // Better Auth JWT payload: { sub: userId, iat, exp, iss, aud }
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
