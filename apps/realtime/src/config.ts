const isProd = process.env.NODE_ENV === 'production';

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
  authJwtPublicKey: (process.env.AUTH_JWT_PUBLIC_KEY ?? '').replace(/\\n/g, '\n'),
  corsOrigin: (process.env.CORS_ORIGIN ?? (isProd ? '' : '*'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;
