/**
 * DB query monitoring — slow query log + Sentry breadcrumb.
 *
 * Plan v2 §15.1 W3-4: phát hiện sớm DB hot path trước khi prod scale.
 *
 * Vì sao tách file thay vì wrap Drizzle trực tiếp:
 *   - Drizzle 0.45 chưa có middleware API public (chỉ logger callback).
 *   - postgres.js `debug` callback fire mọi statement → too noisy. Filter
 *     ở layer riêng.
 *   - Tách giúp test + disable dễ qua env.
 *
 * Pattern dùng:
 *   import { trackQuery } from '@/lib/observability/db-monitor';
 *
 *   const result = await trackQuery('document.list', () =>
 *     db.select().from(document).where(eq(document.userId, userId))
 *   );
 *
 * Wrapping bằng tay là verbose nhưng cho phép tagged query — Sentry breadcrumb
 * + log có context ("query name = document.list").
 *
 * Auto-wrap (Drizzle middleware) sẽ thêm Stage 2 khi extension API stable.
 */
import * as Sentry from '@sentry/nextjs';

import { logger } from './logger';

/**
 * Threshold để alert. Override qua env nếu cần.
 *   - Warn: 100ms (above this, suspect missing index or slow query)
 *   - Error: 1000ms (definitely problematic — block alert)
 */
const SLOW_WARN_MS = parseInt(process.env.DB_SLOW_WARN_MS ?? '100', 10);
const SLOW_ERROR_MS = parseInt(process.env.DB_SLOW_ERROR_MS ?? '1000', 10);

/**
 * Wrap 1 query với tracking. Log slow query + Sentry breadcrumb.
 *
 * @param queryName - Tên unique cho query (vd 'document.list', 'flashcard.due').
 *                    Đặt theo convention `{entity}.{action}` để dashboard aggregate.
 * @param fn - Function thực sự run Drizzle query.
 * @returns Kết quả của fn.
 */
export async function trackQuery<T>(
  queryName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();

  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - start);

    // Breadcrumb cho Sentry — show context khi có error sau đó
    Sentry.addBreadcrumb({
      category: 'db.query',
      message: queryName,
      level: durationMs >= SLOW_WARN_MS ? 'warning' : 'info',
      data: { duration_ms: durationMs },
    });

    // Slow query log + alert
    if (durationMs >= SLOW_ERROR_MS) {
      logger.error('db.query.very_slow', {
        query: queryName,
        duration_ms: durationMs,
        threshold_ms: SLOW_ERROR_MS,
      });
      // Capture với severity warning (không phải error vì query có thể success)
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

/**
 * Batch tracker — track N queries cùng trace (vd page render gọi nhiều query).
 * Trả về 1 wrapper function reuse cùng trace context.
 *
 * Pattern:
 *   const tracked = trackPageQueries('dashboard.home');
 *   const docs = await tracked('document.list', () => db.select()...);
 *   const decks = await tracked('flashcard.list', () => db.select()...);
 */
export function trackPageQueries(pageName: string) {
  return async <T>(queryName: string, fn: () => Promise<T>): Promise<T> => {
    return trackQuery(`${pageName}:${queryName}`, fn);
  };
}

/**
 * Decorator helper cho repo pattern (Stage 2 khi có service class).
 *
 *   class DocumentRepo {
 *     @tracked('document.findById')
 *     async findById(id: string) { ... }
 *   }
 */
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

/**
 * Stats gather — count queries + total time per name trong 1 request scope.
 * Dùng cho server component để emit N+1 warning.
 *
 * Implementation defer cho Stage 2 (cần AsyncLocalStorage trên Node runtime).
 */
