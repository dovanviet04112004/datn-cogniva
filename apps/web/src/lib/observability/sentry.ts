/**
 * Sentry helper — chỉ init nếu env có SENTRY_DSN.
 *
 * Không dùng @sentry/nextjs auto wizard vì:
 *   - Plan Phase 10 v1 chỉ cần basic exception capture, không full APM.
 *   - Tự init cho phép disable hoàn toàn trong dev (DSN trống).
 *
 * 3 file thường cần ở Next.js project: sentry.{client,server,edge}.config.ts
 * — phase này gộp về 1 lib + gọi từ instrumentation.ts (server) +
 * client provider (sẽ tạo ở components/error-boundary.tsx).
 */
import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
const ENV = process.env.NODE_ENV ?? 'development';
let initialized = false;

/** Khởi tạo Sentry SDK — idempotent, no-op nếu thiếu DSN. */
export function initSentry() {
  if (initialized || !DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    // Trace 10% request trong prod, 100% trong dev cho debugging
    tracesSampleRate: ENV === 'production' ? 0.1 : 1.0,
    // Không bật replay/profiling trong v1 (tốn quota free tier)
    enabled: ENV !== 'development', // dev không gửi event ra Sentry
  });
  initialized = true;
}

/** Capture exception với user context optional. */
export function captureError(
  err: unknown,
  context?: { userId?: string; route?: string },
) {
  if (!DSN) {
    console.error('[sentry-noop]', err);
    return;
  }
  Sentry.withScope((scope) => {
    if (context?.userId) scope.setUser({ id: context.userId });
    if (context?.route) scope.setTag('route', context.route);
    Sentry.captureException(err);
  });
}
