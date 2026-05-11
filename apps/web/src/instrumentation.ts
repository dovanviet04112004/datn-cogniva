/**
 * Next.js instrumentation — chạy 1 lần khi server start (cả nodejs + edge runtime).
 *
 * Init các SDK observability ở đây để guarantee chạy trước request đầu tiên.
 * Hiện chỉ Sentry; có thể thêm OpenTelemetry, log forwarder, etc.
 *
 * Note: file phải ở `src/instrumentation.ts` (vì `srcDir` config) hoặc
 * `instrumentation.ts` ở root. Next.js auto-detect khi build.
 */
import { initSentry } from '@/lib/observability/sentry';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    initSentry();
  }
  // Edge runtime cũng chạy đoạn này; Sentry tự xử lý edge mode.
  if (process.env.NEXT_RUNTIME === 'edge') {
    initSentry();
  }
}
