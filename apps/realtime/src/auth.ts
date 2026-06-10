/**
 * Auth gateway = ONE source of truth: gọi ngược Next `POST /api/realtime/auth`.
 *
 * Vì sao không tự query DB/verify session ở gateway: giữ đúng chuẩn đã chốt
 * (getServerSession + Better Auth secondaryStorage + logic membership 1 chỗ). Gateway
 * chỉ forward credential → Next trả về danh tính / cho phép. Round-trip chỉ xảy ra lúc
 * CONNECT (1 lần/kết nối) và SUBSCRIBE (1 lần/channel) — localhost, hiếm, không phải mỗi message.
 *
 * Credential:
 *   - Web   : cookie (better-auth.session_token) trong handshake.headers.cookie.
 *   - Mobile: bearer token client truyền qua `auth: { token }` → handshake.auth.token →
 *             dựng header `Authorization: Bearer <token>` (Better Auth bearer plugin).
 */
import { cfg } from './config';

export type Identity = { id: string; name: string; image: string | null };

type Handshake = {
  headers: { cookie?: string; authorization?: string };
  auth?: { token?: string };
};

/**
 * Gọi Next verify. channel rỗng = chỉ whoami (lúc connect). channel có = authorize membership.
 * Trả Identity nếu OK, null nếu 401/403/lỗi mạng.
 */
async function callAuth(handshake: Handshake, channel?: string): Promise<Identity | null> {
  const cookie = handshake.headers.cookie ?? '';
  const token = handshake.auth?.token;
  const authorization = token ? `Bearer ${token}` : (handshake.headers.authorization ?? '');

  try {
    const res = await fetch(`${cfg.internalApiUrl}/api/realtime/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, authorization },
      body: JSON.stringify({ channel }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: Identity };
    return data.user ?? null;
  } catch (err) {
    console.error('[realtime/auth] call Next fail:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Verify session lúc handshake (không kèm channel). */
export function verifySession(handshake: Handshake): Promise<Identity | null> {
  return callAuth(handshake);
}

/** Authorize quyền vào 1 channel cụ thể. */
export function authorizeChannel(handshake: Handshake, channel: string): Promise<boolean> {
  return callAuth(handshake, channel).then(Boolean);
}
