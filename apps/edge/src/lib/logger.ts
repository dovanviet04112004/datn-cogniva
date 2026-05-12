/**
 * Structured JSON logger cho Workers — match format với apps/web logger.
 *
 * Workers `console.log` được Cloudflare ingest tự động (Logpush, Tail, dashboard).
 * Output JSON 1-line để dễ filter (jq, Splunk, Datadog).
 *
 * KHÔNG dùng Sentry SDK ở edge vì:
 *   - Bundle size > 100KB, vượt Workers free 1MB nhưng add latency cold start
 *   - Workers free tier 50ms CPU — Sentry SDK CPU overhead lớn
 *   - Thay vào đó: forward error qua header `x-edge-error` để origin Sentry capture.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  trace_id?: string;
  user_id?: string | null;
  [key: string]: unknown;
}

function emit(level: LogLevel, event: string, ctx?: LogContext): void {
  const payload = {
    level,
    event,
    ts: new Date().toISOString(),
    ...(ctx ?? {}),
  };
  // Workers console.log: 1 record per call → 1 log line.
  if (level === 'error') console.error(JSON.stringify(payload));
  else if (level === 'warn') console.warn(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

export const logger = {
  debug: (event: string, ctx?: LogContext) => emit('debug', event, ctx),
  info: (event: string, ctx?: LogContext) => emit('info', event, ctx),
  warn: (event: string, ctx?: LogContext) => emit('warn', event, ctx),
  error: (event: string, ctx?: LogContext) => emit('error', event, ctx),
};
