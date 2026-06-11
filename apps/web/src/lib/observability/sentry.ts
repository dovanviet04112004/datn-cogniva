import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
const ENV = process.env.NODE_ENV ?? 'development';
let initialized = false;

export function initSentry() {
  if (initialized || !DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    tracesSampleRate: ENV === 'production' ? 0.1 : 1.0,
    enabled: ENV !== 'development',
  });
  initialized = true;
}

export function captureError(err: unknown, context?: { userId?: string; route?: string }) {
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
