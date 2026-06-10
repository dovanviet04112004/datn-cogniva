/**
 * Cấu hình gateway — đọc env 1 lần.
 *
 * Dev: có default localhost (khỏi cần truyền env → `pnpm dev:all` chạy thẳng, cross-platform).
 * Prod (NODE_ENV=production): fail-fast nếu thiếu REDIS_URL / INTERNAL_API_URL.
 *
 * Biến:
 *   - PORT             : cổng WS (mặc định 6002). Caddy proxy wss://realtime.* → cổng này.
 *   - REDIS_URL        : ioredis cho adapter + presence. Phải TRÙNG Redis của apps/web.
 *   - INTERNAL_API_URL : base URL Next.js để verify session/authorize membership.
 *   - CORS_ORIGIN      : origin web được phép kết nối (cookie). '*' = mọi origin (chỉ dev).
 */
const isProd = process.env.NODE_ENV === 'production';

/** Lấy env; prod thiếu → exit, dev → dùng default localhost. */
function envOr(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProd) {
    console.error(`[realtime] Thiếu env bắt buộc (production): ${name}`);
    process.exit(1);
  }
  return devDefault;
}

export const cfg = {
  port: Number(process.env.PORT ?? 6002),
  redisUrl: envOr('REDIS_URL', 'redis://localhost:6379'),
  internalApiUrl: envOr('INTERNAL_API_URL', 'http://localhost:3000').replace(/\/$/, ''),
  corsOrigin: (process.env.CORS_ORIGIN ?? (isProd ? '' : '*'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;
