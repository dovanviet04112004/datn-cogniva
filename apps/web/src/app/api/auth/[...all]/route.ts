/**
 * Catch-all route handler cho Better Auth.
 *
 * Better Auth phơi nhiều endpoint nội bộ: /api/auth/sign-in, /api/auth/sign-up,
 * /api/auth/sign-out, /api/auth/callback/google, ... Thay vì khai báo từng
 * file route, dùng segment dynamic `[...all]` để map MỌI request tới handler
 * tự sinh của Better Auth (`toNextJsHandler`).
 *
 * Client (lib/auth-client.ts) gọi tới các path này qua fetch — handler bên
 * dưới sẽ chuyển vào auth.handler đã được Better Auth khởi tạo.
 */
import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';

export const { GET, POST } = toNextJsHandler(auth);
