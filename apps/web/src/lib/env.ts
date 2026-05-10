/**
 * Validate biến môi trường bằng Zod — fail-fast nếu thiếu/sai định dạng.
 *
 * Vì sao có file này?
 *  - process.env trả về string | undefined → app code phải tự check khắp nơi.
 *  - Nếu deploy mà thiếu BETTER_AUTH_SECRET, bug chỉ phát hiện khi user thử
 *    đăng ký → tệ. Validate ngay lúc module load để crash sớm với log rõ.
 *  - Tách schema server/client: biến server (DATABASE_URL, secret…) không
 *    được leak ra client bundle. Khi `typeof window !== 'undefined'`, ta chỉ
 *    parse client schema để tránh đọc nhầm key chưa được expose.
 *
 * Tất cả biến hiện tại đều `optional()` để Phase 0 không cần điền hết —
 * sẽ siết lại khi từng tính năng đi vào sản xuất (ví dụ Phase 2 sẽ require
 * ANTHROPIC_API_KEY).
 */
import { z } from 'zod';

// Schema chỉ xuất hiện ở runtime server (Node/Edge runtime của Next.js)
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().optional(),
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  COHERE_API_KEY: z.string().optional(),
});

// Schema được expose ra client — chỉ key có prefix NEXT_PUBLIC_ mới an toàn
const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

// processEnv được "destructure" thủ công vì Next.js statically replace
// `process.env.X` trong client bundle — phải viết dạng property access trực tiếp,
// không thể vòng qua biến trung gian (sẽ thành `undefined` lúc build).
const processEnv = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  COHERE_API_KEY: process.env.COHERE_API_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

const isServer = typeof window === 'undefined';
const merged = serverSchema.merge(clientSchema);
// Trên server validate cả 2 schema; trên client chỉ validate phần public
const parsed = isServer ? merged.safeParse(processEnv) : clientSchema.safeParse(processEnv);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

/** Biến môi trường đã validate, dùng làm thay thế typed cho `process.env`. */
export const env = parsed.data as z.infer<typeof serverSchema> & z.infer<typeof clientSchema>;
