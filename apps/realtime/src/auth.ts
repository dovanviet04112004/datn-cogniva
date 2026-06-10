/**
 * Auth gateway — 2 tầng (dual-accept 1 wave, theo plan NestJS §3):
 *
 * CONNECT (verifySession):
 *   1. LOCAL : client cầm access token JWT mới (cookie `cg_at` web / `auth.token` mobile,
 *      3 segment) → jose jwtVerify ES256 bằng AUTH_JWT_PUBLIC_KEY ngay tại gateway —
 *      claims {sub, name, picture} đủ dựng Identity, KHÔNG round-trip HTTP/DB.
 *   2. FALLBACK HTTP : token cũ Better Auth (bearer 2 phần / cookie session) hoặc thiếu
 *      public key / JWT hết hạn → gọi `POST /api/realtime/auth` như cũ (whoami).
 *
 * SUBSCRIBE (authorizeChannel): luôn HTTP — logic membership giữ 1 chỗ ở server API.
 * Origin = REALTIME_AUTH_ORIGIN ?? INTERNAL_API_URL (sau cutover prefix `realtime`,
 * Next tự proxy sang Nest — không bắt buộc đổi env).
 *
 * Credential:
 *   - Web   : cookie (cg_at / better-auth.session_token) trong handshake.headers.cookie.
 *   - Mobile: token client truyền qua `auth: { token }` → handshake.auth.token →
 *             dựng header `Authorization: Bearer <token>`.
 */
import { importSPKI, jwtVerify, type KeyLike } from 'jose';

import { cfg } from './config';

export type Identity = { id: string; name: string; image: string | null };

type Handshake = {
  headers: { cookie?: string; authorization?: string };
  auth?: { token?: string };
};

// NGUỒN CHUẨN ở apps/api/src/common/auth/token.service.ts — phải khớp khi verify.
const JWT_ALG = 'ES256';
const JWT_ISSUER = 'cogniva';
const JWT_AUDIENCE = 'cogniva-app';

/** Public key import 1 lần (lazy — importSPKI async). Env thiếu/PEM hỏng → null = tắt local verify. */
let publicKeyPromise: Promise<KeyLike | null> | null = null;
function getPublicKey(): Promise<KeyLike | null> {
  if (!publicKeyPromise) {
    publicKeyPromise = cfg.authJwtPublicKey
      ? importSPKI(cfg.authJwtPublicKey, JWT_ALG).catch((err) => {
          console.error(
            '[realtime/auth] AUTH_JWT_PUBLIC_KEY không hợp lệ — tắt local verify:',
            err instanceof Error ? err.message : err,
          );
          return null;
        })
      : Promise.resolve(null);
  }
  return publicKeyPromise;
}

/** Lấy JWT 3 segment từ handshake: auth.token (mobile) ưu tiên, rồi cookie cg_at (web). */
function extractJwt(handshake: Handshake): string | null {
  const token = handshake.auth?.token;
  if (token && token.split('.').length === 3) return token;
  const m = (handshake.headers.cookie ?? '').match(/(?:^|;\s*)cg_at=([^;]+)/);
  return m?.[1] ?? null;
}

/** Verify access token cục bộ → Identity từ claims. Mọi thất bại → null (caller fallback HTTP). */
async function verifyLocal(handshake: Handshake): Promise<Identity | null> {
  const jwt = extractJwt(handshake);
  if (!jwt) return null;
  const key = await getPublicKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(jwt, key, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      // Token phát trước khi thêm claims name/picture → fallback '' / null.
      name: typeof payload.name === 'string' ? payload.name : '',
      image: typeof payload.picture === 'string' ? payload.picture : null,
    };
  } catch {
    return null; // hết hạn / sai chữ ký → để HTTP fallback quyết (dual-accept)
  }
}

/**
 * Gọi API verify. channel rỗng = chỉ whoami (lúc connect). channel có = authorize membership.
 * Trả Identity nếu OK, null nếu 401/403/lỗi mạng.
 */
async function callAuth(handshake: Handshake, channel?: string): Promise<Identity | null> {
  const cookie = handshake.headers.cookie ?? '';
  const token = handshake.auth?.token;
  const authorization = token ? `Bearer ${token}` : (handshake.headers.authorization ?? '');

  try {
    const res = await fetch(`${cfg.authOrigin}/api/realtime/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, authorization },
      body: JSON.stringify({ channel }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: Identity };
    return data.user ?? null;
  } catch (err) {
    console.error('[realtime/auth] call API fail:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Verify session lúc handshake (không kèm channel): local JWT trước, fallback HTTP. */
export async function verifySession(handshake: Handshake): Promise<Identity | null> {
  return (await verifyLocal(handshake)) ?? callAuth(handshake);
}

/** Authorize quyền vào 1 channel cụ thể. */
export function authorizeChannel(handshake: Handshake, channel: string): Promise<boolean> {
  return callAuth(handshake, channel).then(Boolean);
}
