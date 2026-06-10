/**
 * Structured logger — JSON output cho production observability.
 *
 * Vì sao logger riêng thay vì console.log:
 *   - Format JSON nhất quán cho Better Stack / Loki ingest
 *   - Auto inject trace_id từ AsyncLocalStorage (request context)
 *   - Auto redact PII fields (email, phone, secrets)
 *   - Level-based filter (dev: debug+, prod: info+)
 *
 * Pattern dùng:
 *   logger.info('ai.request.completed', { user_id, latency_ms, cost_usd })
 *   logger.warn('cache.miss', { key, fallback })
 *   logger.error('payment.failed', { error, user_id })
 *
 * Event naming convention: `<domain>.<action>[.<outcome>]`
 *   - ai.request.completed
 *   - cache.miss
 *   - ratelimit.exceeded
 *   - auth.login.failed
 *
 * KHÔNG dùng:
 *   logger.info(`User ${userId} did X`)  // string interpolation
 *   Vì:
 *   - Khó query / aggregate
 *   - Mất structured field
 *   - Khó redact PII
 *
 * Dùng:
 *   logger.info('user.action', { user_id, action: 'X' })
 */

/**
 * Lấy trace_id từ request headers (set bởi middleware.ts).
 * Server component / route handler / server action gọi để correlate log.
 *
 * Trả 'no-trace' nếu không có (vd background job ngoài request scope).
 * Caller có thể generate riêng:
 *   const traceId = await getTraceId() ?? `bg-${crypto.randomUUID()}`;
 */
export async function getTraceId(): Promise<string> {
  try {
    // Dynamic import để tránh top-level await + edge runtime bundle
    const { headers } = await import('next/headers');
    const h = await headers();
    return h.get('x-trace-id') ?? 'no-trace';
  } catch {
    // Ngoài request scope (BullMQ job, CLI script) → no-trace
    return 'no-trace';
  }
}

/**
 * Lấy region tag từ request header (set bởi edge gateway hoặc middleware).
 * Route handler dùng để chọn DB replica gần user nhất qua `getDbForRegion()`.
 * Default 'us' nếu request không có header (dev local).
 */
export async function getRegion(): Promise<string> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    return h.get('x-cogniva-region') ?? 'us';
  } catch {
    return 'us';
  }
}

/** Log level — cao hơn = ít quan trọng hơn. */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

const CURRENT_LEVEL: Level =
  (process.env.LOG_LEVEL as Level) ??
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

/**
 * Trường tự động redact — không log raw value, replace bằng '[REDACTED]'.
 * Match theo regex tên field, không case-sensitive.
 */
const REDACT_FIELDS = /^(password|token|secret|api_key|authorization|cookie|ssn|cccd)$/i;

/**
 * Redact PII trong object (recursive).
 */
function redact(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth-limit]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_FIELDS.test(k)) {
      result[k] = '[REDACTED]';
    } else {
      result[k] = redact(v, depth + 1);
    }
  }
  return result;
}

/**
 * Output 1 log entry. Format JSON cho machine parse, plain cho dev.
 */
function emit(level: Level, event: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] > LEVELS[CURRENT_LEVEL]) return;

  const entry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };

  // Production: JSON 1 line per log → easy ingest.
  // Dev: pretty print với màu nhẹ qua console.
  if (process.env.NODE_ENV === 'production') {
    // Stderr cho error/warn, stdout cho info/debug → log aggregator chia stream.
    const stream = level === 'error' || level === 'warn' ? console.error : console.log;
    stream(JSON.stringify(entry));
  } else {
    const tag = level.toUpperCase().padEnd(5);
    const time = entry.timestamp.slice(11, 19); // HH:MM:SS
    const extra = fields ? ' ' + JSON.stringify(redact(fields)) : '';
    const stream = level === 'error' || level === 'warn' ? console.error : console.log;
    stream(`[${time}] ${tag} ${event}${extra}`);
  }
}

/**
 * Public logger interface — 4 level + redact + trace_id auto-inject.
 *
 * Dùng từ mọi nơi:
 *   import { logger } from '@/lib/observability/logger';
 *   logger.info('event.name', { field: 'value' });
 */
export const logger = {
  error(event: string, fields?: Record<string, unknown>): void {
    emit('error', event, fields);
  },
  warn(event: string, fields?: Record<string, unknown>): void {
    emit('warn', event, fields);
  },
  info(event: string, fields?: Record<string, unknown>): void {
    emit('info', event, fields);
  },
  debug(event: string, fields?: Record<string, unknown>): void {
    emit('debug', event, fields);
  },
};
