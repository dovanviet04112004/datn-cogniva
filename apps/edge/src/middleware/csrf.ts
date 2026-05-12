/**
 * CSRF middleware — double-submit cookie pattern.
 *
 * Strategy:
 *   - GET/HEAD/OPTIONS: pass-through, NHƯNG nếu chưa có cookie `csrf-token`
 *     → set cookie mới (random 32 byte hex).
 *   - POST/PUT/PATCH/DELETE: yêu cầu header `x-csrf-token` MATCH cookie.
 *     Mismatch / missing → 403.
 *
 * Bypass: route `/api/auth/*` (Better Auth tự xử CSRF qua state nonce),
 *         route `/api/webhooks/*` (verify signature header, không cần CSRF),
 *         GET /api/health, /api/realtime/* (SSE).
 *
 * Why double-submit (cookie + header) thay vì synchronizer token:
 *   - Edge stateless → KHÔNG lưu nonce server-side
 *   - Cookie SameSite=Lax đã ngăn cross-origin POST → header check là defense-in-depth
 *   - Origin Vercel cũng kiểm cookie SameSite → 2 layer
 */
import type { MiddlewareHandler } from 'hono';

import type { HonoEnv } from '../env';
import { logger } from '../lib/logger';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const BYPASS_PREFIXES = ['/api/auth/', '/api/webhooks/', '/api/health', '/api/realtime/'];
const COOKIE_NAME = 'csrf-token';
const HEADER_NAME = 'x-csrf-token';

function bypass(pathname: string): boolean {
  return BYPASS_PREFIXES.some((p) => pathname.startsWith(p));
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string compare — chống timing attack.
 * 2 string khác length → false ngay (length is not secret).
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function csrf(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const url = new URL(c.req.url);
    if (bypass(url.pathname)) return next();

    const cookieHeader = c.req.header('cookie') ?? null;
    const cookieToken = readCookie(cookieHeader, COOKIE_NAME);

    if (SAFE_METHODS.has(c.req.method)) {
      // Issue cookie nếu chưa có (lần đầu vào site).
      if (!cookieToken) {
        const token = generateToken();
        const secure = c.env.ENV !== 'local' ? '; Secure' : '';
        c.header(
          'Set-Cookie',
          `${COOKIE_NAME}=${token}; Path=/; SameSite=Lax; Max-Age=86400${secure}`,
          { append: true },
        );
      }
      return next();
    }

    // Mutating method — cần header match cookie
    const headerToken = c.req.header(HEADER_NAME);
    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      logger.warn('csrf.token_mismatch', {
        trace_id: c.get('traceId'),
        has_cookie: !!cookieToken,
        has_header: !!headerToken,
        path: url.pathname,
      });
      return c.json(
        {
          error: 'csrf_invalid',
          message: 'CSRF token không hợp lệ. Reload trang và thử lại.',
        },
        403,
      );
    }

    return next();
  };
}
