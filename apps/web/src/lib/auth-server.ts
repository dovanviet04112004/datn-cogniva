/**
 * auth-server.ts — Helper getSession phía server, DEDUP trong 1 request (server-only).
 *
 * `react.cache()` memo theo request: trong CÙNG 1 request, layout + topbar + page con
 * gọi `getServerSession()` chỉ resolve session MỘT lần (thay vì mỗi chỗ gọi lại
 * `auth.api.getSession` → 3-5 lần). Kết hợp P1 (secondaryStorage Redis): mỗi lần resolve
 * cũng đã rẻ (~1-5ms Redis / 0 nếu cookieCache hit, thay vì 50-100ms Neon).
 *
 * Dùng thay `auth.api.getSession({ headers: await headers() })` ở MỌI server component
 * trong (app). Mobile không chạm (RSC-only). Không đổi contract/bảo mật — chỉ thêm memo.
 */
import { cache } from 'react';
import { headers } from 'next/headers';

import { auth } from '@/lib/auth';

/** Session của request hiện tại, deduped. Trả null nếu chưa đăng nhập. */
export const getServerSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);
