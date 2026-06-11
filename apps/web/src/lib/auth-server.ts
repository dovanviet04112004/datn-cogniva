/**
 * auth-server.ts — getSession phía server trên JWT stack mới (NestJS, Wave 7).
 *
 * Verify cookie `cg_at` (access JWT ES256, 15') CỤC BỘ bằng JWKS công khai của
 * NestJS — không gọi network mỗi request: `createRemoteJWKSet` ở module-level
 * để jose tự cache key (tự refetch khi gặp `kid` lạ → key rotation an toàn).
 *
 * `react.cache()` memo theo request: layout + topbar + page con gọi
 * `getServerSession()` chỉ verify MỘT lần. Không đăng nhập / token hỏng /
 * hết hạn → trả null (middleware + page tự redirect, refresh do client lo).
 *
 * Shape trả về build từ claims (sub, email, name, picture, plan, role) — đủ
 * cho mọi caller hiện tại (id/email/name/image). Field ngoài claims (vd
 * twoFactorEnabled) caller phải tự query DB — KHÔNG nhét vào đây.
 */
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const NEST_ORIGIN = process.env.NEST_API_ORIGIN ?? 'http://localhost:4000';

// Module-level — jose cache JWK set giữa các request trong cùng process.
const JWKS = createRemoteJWKSet(new URL(`${NEST_ORIGIN}/api/auth/jwks`));

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  plan: string | null;
  /** adminRole từ claim `role` — guard admin vẫn re-check DB, đây chỉ là hint. */
  role: string | null;
};

export type ServerSession = { user: SessionUser };

/** Session của request hiện tại, deduped. Trả null nếu chưa đăng nhập. */
export const getServerSession = cache(async (): Promise<ServerSession | null> => {
  const token = (await cookies()).get('cg_at')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      algorithms: ['ES256'],
      issuer: 'cogniva',
      audience: 'cogniva-app',
    });
    if (!payload.sub || typeof payload.email !== 'string') return null;
    return {
      user: {
        id: payload.sub,
        email: payload.email,
        name: typeof payload.name === 'string' ? payload.name : null,
        image: typeof payload.picture === 'string' ? payload.picture : null,
        plan: typeof payload.plan === 'string' ? payload.plan : null,
        role: typeof payload.role === 'string' ? payload.role : null,
      },
    };
  } catch {
    // Token hết hạn / chữ ký sai / JWKS unreachable → coi như chưa đăng nhập.
    return null;
  }
});
