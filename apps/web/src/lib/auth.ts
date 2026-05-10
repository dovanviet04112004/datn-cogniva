/**
 * Cấu hình Better Auth phía server — file này KHÔNG được import từ client.
 *
 * Trách nhiệm:
 *  - Gắn Better Auth vào Drizzle adapter (postgres) để tận dụng schema có
 *    sẵn ở packages/db (bảng user/session/account/verification).
 *  - Bật email + password (autoSignIn để user đăng ký xong vào thẳng app).
 *  - Bật Google OAuth NHƯNG chỉ khi env có cả CLIENT_ID + CLIENT_SECRET —
 *    dev local thường không đặt → để Better Auth bỏ qua provider này.
 *  - Mở rộng user với cột `plan` (FREE/PRO/TEAM) — additionalFields giúp
 *    Better Auth hiểu cột Cogniva thêm vào.
 *  - Bật cookie cache 5 phút để giảm lượng query session token mỗi request
 *    (server component thường gọi getSession nhiều lần / page).
 *  - Plugin nextCookies(): cần thiết để các server action/handler set cookie
 *    đúng cách trong môi trường Next.js (RSC + middleware).
 *
 * Server component / route handler dùng:
 *   const session = await auth.api.getSession({ headers: await headers() });
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';

import { account, db, session, user, verification } from '@cogniva/db';

// Ưu tiên BETTER_AUTH_URL (thường là URL deploy production).
// Fallback NEXT_PUBLIC_APP_URL → giúp dev local chỉ cần set 1 biến.
const baseURL =
  process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const auth = betterAuth({
  baseURL,
  // Secret để ký session token. Production BẮT BUỘC override bằng giá trị
  // sinh từ `openssl rand -base64 32`. Default chỉ để dev không crash.
  secret: process.env.BETTER_AUTH_SECRET ?? 'dev-only-secret-change-me',
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  // Conditional spread: chỉ thêm Google nếu cả 2 env tồn tại
  // → tránh Better Auth báo lỗi cấu hình thiếu khi dev local.
  socialProviders:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined,
  user: {
    additionalFields: {
      // input: false → user không thể tự sửa plan từ form; chỉ sửa qua API
      // backend (sau khi thanh toán Stripe thành công).
      plan: {
        type: 'string',
        defaultValue: 'FREE',
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 ngày — phù hợp cho app học tập (dùng dài hạn)
    updateAge: 60 * 60 * 24, // mỗi 1 ngày refresh expiry (sliding session)
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 phút — chấp nhận trade-off latency vs accuracy
    },
  },
  plugins: [nextCookies()],
});

/** Kiểu suy luận của session — dùng để type props server component. */
export type Session = typeof auth.$Infer.Session;
export type AuthUser = Session['user'];
