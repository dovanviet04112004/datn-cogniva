/**
 * Cấu hình gateway — đọc env 1 lần.
 *
 * Dev: có default localhost (khỏi cần truyền env → `pnpm dev:all` chạy thẳng, cross-platform).
 * Prod (NODE_ENV=production): fail-fast nếu thiếu REDIS_URL / INTERNAL_API_URL.
 *
 * Biến:
 *   - PORT                : cổng WS (mặc định 6002). Caddy proxy wss://realtime.* → cổng này.
 *   - REDIS_URL           : ioredis cho adapter + presence. Phải TRÙNG Redis của apps/web.
 *   - INTERNAL_API_URL    : base URL Next.js để verify session/authorize membership.
 *   - REALTIME_AUTH_ORIGIN: (tuỳ chọn) origin riêng cho /api/realtime/auth — sau cutover
 *                           trỏ thẳng Nest; thiếu → dùng INTERNAL_API_URL (Next proxy hộ).
 *   - AUTH_JWT_PUBLIC_KEY : (tuỳ chọn) public key ES256 (PEM) của hệ JWT mới — có thì
 *                           verify access token CỤC BỘ lúc connect, khỏi round-trip HTTP.
 *                           Thiếu → bỏ qua local verify, mọi thứ chạy qua HTTP như cũ.
 *   - CORS_ORIGIN         : origin web được phép kết nối (cookie). '*' = mọi origin (chỉ dev).
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

const internalApiUrl = envOr('INTERNAL_API_URL', 'http://localhost:3000').replace(/\/$/, '');

export const cfg = {
  port: Number(process.env.PORT ?? 6002),
  redisUrl: envOr('REDIS_URL', 'redis://localhost:6379'),
  internalApiUrl,
  authOrigin: (process.env.REALTIME_AUTH_ORIGIN ?? internalApiUrl).replace(/\/$/, ''),
  // Env có thể lưu PEM 1 dòng với literal \n (giống apps/api) → normalize về newline thật.
  authJwtPublicKey: (process.env.AUTH_JWT_PUBLIC_KEY ?? '').replace(/\\n/g, '\n'),
  corsOrigin: (process.env.CORS_ORIGIN ?? (isProd ? '' : '*'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;
