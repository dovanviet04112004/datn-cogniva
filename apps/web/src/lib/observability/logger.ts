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

// Phần logger core (emit/redact/level) đã move sang @cogniva/server-core để
// NestJS dùng chung — file này chỉ giữ getTraceId/getRegion (cần next/headers).
export { logger } from '@cogniva/server-core/logger';
