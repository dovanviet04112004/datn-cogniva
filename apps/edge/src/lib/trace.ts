/**
 * Trace ID utilities — match format với apps/web/src/middleware.ts:
 *   cog-{16hex}-{8hex}
 *
 * Reuse upstream trace ID nếu request có (Sentry distributed tracing).
 * KHÔNG fragment trace giữa client → edge → origin.
 */
export function generateTraceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `cog-${hex.slice(0, 16)}-${hex.slice(16, 24)}`;
}

export function getOrCreateTraceId(request: Request): string {
  const existing = request.headers.get('x-trace-id');
  if (existing && /^cog-[0-9a-f]{16}-[0-9a-f]{8}$/.test(existing)) {
    return existing;
  }
  return generateTraceId();
}
