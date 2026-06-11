import * as Sentry from '@sentry/nextjs';

import { logger } from './logger';

const SLOW_WARN_MS = parseInt(process.env.DB_SLOW_WARN_MS ?? '100', 10);
const SLOW_ERROR_MS = parseInt(process.env.DB_SLOW_ERROR_MS ?? '1000', 10);

export async function trackQuery<T>(queryName: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();

  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - start);

    Sentry.addBreadcrumb({
      category: 'db.query',
      message: queryName,
      level: durationMs >= SLOW_WARN_MS ? 'warning' : 'info',
      data: { duration_ms: durationMs },
    });

    if (durationMs >= SLOW_ERROR_MS) {
      logger.error('db.query.very_slow', {
        query: queryName,
        duration_ms: durationMs,
        threshold_ms: SLOW_ERROR_MS,
      });
      Sentry.captureMessage(`DB query very slow: ${queryName} (${durationMs}ms)`, 'warning');
    } else if (durationMs >= SLOW_WARN_MS) {
      logger.warn('db.query.slow', {
        query: queryName,
        duration_ms: durationMs,
        threshold_ms: SLOW_WARN_MS,
      });
    } else if (process.env.DB_DEBUG === '1') {
      logger.debug('db.query.ok', {
        query: queryName,
        duration_ms: durationMs,
      });
    }

    return result;
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    logger.error('db.query.failed', {
      query: queryName,
      duration_ms: durationMs,
      error: err instanceof Error ? err.message : String(err),
    });
    Sentry.captureException(err, {
      tags: { query: queryName },
      extra: { duration_ms: durationMs },
    });
    throw err;
  }
}

export function trackPageQueries(pageName: string) {
  return async <T>(queryName: string, fn: () => Promise<T>): Promise<T> => {
    return trackQuery(`${pageName}:${queryName}`, fn);
  };
}

export function tracked(queryName: string) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    _target: object,
    _key: string,
    descriptor: TypedPropertyDescriptor<T>,
  ): TypedPropertyDescriptor<T> {
    const original = descriptor.value!;
    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      return trackQuery(queryName, () => original.apply(this, args));
    } as T;
    return descriptor;
  };
}
