/**
 * Pusher (Soketi) server helper — trigger event từ Next.js route handler.
 *
 * Soketi protocol-compatible với Pusher → dùng `pusher` npm package, chỉ
 * override `host` về self-hosted endpoint. App secret KHÔNG bao giờ leak ra
 * client; client dùng key public + auth endpoint signed bằng secret này.
 *
 * Channel naming convention (Phase 13+):
 *   - `presence-room-{roomId}`     : presence channel cho room participants
 *   - `presence-user-{userId}`     : private channel cho notification 1-1
 *   - `exam-{examId}`              : public channel cho live exam broadcast
 *   - `tournament-{examId}`        : public cho tournament bracket update
 *
 * Lazy init giống livekit.ts — không throw lúc import nếu env thiếu.
 */
import Pusher from 'pusher';

function requireSoketiEnv() {
  const appId = process.env.SOKETI_APP_ID;
  const key = process.env.NEXT_PUBLIC_SOKETI_KEY;
  const secret = process.env.SOKETI_SECRET;
  const host = process.env.NEXT_PUBLIC_SOKETI_HOST;
  if (!appId || !key || !secret || !host) {
    throw new Error(
      'Soketi env chưa cấu hình. Cần SOKETI_APP_ID + NEXT_PUBLIC_SOKETI_KEY + ' +
        'SOKETI_SECRET + NEXT_PUBLIC_SOKETI_HOST. Xem infrastructure/README.md.',
    );
  }
  return { appId, key, secret, host };
}

let _pusher: Pusher | null = null;

/** Singleton Pusher server SDK — dev + prod auto-detect TLS. */
export function getPusherServer(): Pusher {
  if (!_pusher) {
    const { appId, key, secret, host } = requireSoketiEnv();
    // Local dev: host=localhost → port 6001 ws (no TLS).
    // Prod: host=soketi.cogniva.com → 443 wss (qua Caddy TLS).
    const isLocal = host === 'localhost' || host.startsWith('127.');
    _pusher = new Pusher({
      appId,
      key,
      secret,
      host,
      port: isLocal ? '6001' : '443',
      useTLS: !isLocal,
    });
  }
  return _pusher;
}

/**
 * Trigger 1 event tới 1 channel — wrapper an toàn (không throw lên route).
 * Trả về { ok: boolean } để caller quyết định fallback nếu Soketi down.
 */
export async function triggerEvent(
  channel: string,
  event: string,
  data: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await getPusherServer().trigger(channel, event, data);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[soketi] trigger fail: ${channel}/${event} — ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * Sign auth payload cho presence/private channel — gọi từ
 * `POST /api/realtime/auth` (Phase 14).
 */
export function authorizeChannel(
  socketId: string,
  channel: string,
  user: { user_id: string; user_info: Record<string, unknown> },
) {
  return getPusherServer().authorizeChannel(socketId, channel, user);
}
