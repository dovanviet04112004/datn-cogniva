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

export const authClient = createAuthClient({
  // Khi không set baseURL, Better Auth tự dùng origin hiện tại của trang —
  // đủ cho mọi case (dev localhost + prod cùng origin).
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? undefined,
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
