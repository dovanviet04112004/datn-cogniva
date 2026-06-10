/**
 * Validate env lúc boot — kiểm GIÁ TRỊ chứ không chỉ "có set" (bài học
 * ANTHROPIC_API_KEY rỗng từng làm hiểu sai provider đang chạy).
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url().startsWith('postgresql'),
  DIRECT_DATABASE_URL: z.string().url().startsWith('postgresql').optional(),
  REDIS_URL: z.string().url().startsWith('redis'),
  BETTER_AUTH_SECRET: z.string().min(16, 'BETTER_AUTH_SECRET quá ngắn — phải trùng với apps/web'),
  // Keypair ES256 (PEM) cho JWT mới — sinh bằng: node scripts/setup-env.mjs
  AUTH_JWT_PRIVATE_KEY: z.string().includes('PRIVATE KEY'),
  AUTH_JWT_PUBLIC_KEY: z.string().includes('PUBLIC KEY'),
  // Origin frontend — dựng link email (reset password) + redirect_uri OAuth.
  APP_URL: z.string().url().default('http://localhost:3000'),
  // Google OAuth — optional như hệ cũ: thiếu → endpoint /auth/google trả 503.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Env không hợp lệ:\n${JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)}`);
  }
  return parsed.data;
}
