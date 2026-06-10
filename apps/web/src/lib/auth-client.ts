/**
 * Better Auth client — dùng phía browser (client component).
 *
 * Khác với `lib/auth.ts` (server-only), file này chỉ chứa các hàm gọi HTTP
 * tới `/api/auth/*` — KHÔNG truy cập DB hay secret. Có thể import an toàn
 * trong "use client" component.
 *
 * Re-export shorthand `signIn`, `signUp`, `signOut`, `useSession` để form
 * và menu user import gọn:
 *   import { signIn } from '@/lib/auth-client';
 *   await signIn.email({ email, password });
 */
import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  // TRÊN TRÌNH DUYỆT: luôn dùng origin hiện tại của trang (window.location.origin)
  // → chạy đúng ở localhost, LAN IP, tunnel (cloudflared/ngrok) và prod mà không
  // phụ thuộc NEXT_PUBLIC_APP_URL. Trước đây hardcode env=localhost nên mở qua
  // tunnel HTTPS trên điện thoại → client gọi http://localhost (mixed-content +
  // unreachable) → "Failed to fetch". SSR (không có window) mới fallback env.
  baseURL:
    typeof window !== 'undefined'
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? undefined,
  plugins: [
    // Phase 6 — 2FA TOTP. Khi sign-in user đã enable 2FA, plugin tự redirect
    // tới /admin/sign-in/two-factor (trang verify code). Set qua callback để
    // không full-reload page giữa flow login.
    twoFactorClient({
      onTwoFactorRedirect() {
        if (typeof window !== 'undefined') {
          window.location.href = '/admin/sign-in/two-factor';
        }
      },
    }),
  ],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
