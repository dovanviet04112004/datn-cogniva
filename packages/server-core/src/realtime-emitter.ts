/**
 * Realtime server helper — phát event tới client qua Socket.IO gateway (apps/realtime).
 *
 * KHÔNG mở kết nối Socket.IO ở tiến trình Next. Thay vào đó dùng
 * `@socket.io/redis-emitter`: publish event vào Redis → `@socket.io/redis-adapter` ở
 * gateway nhận và fan-out tới mọi socket trong room (kể cả nhiều replica gateway).
 * REDIS_URL ở đây PHẢI trùng Redis của gateway.
 *
 * Quy ước domain event: `emit(event, channel, data)` — `channel` là arg #1 để client
 * `useRealtimeEvent(channel, event, h)` lọc đúng channel (1 socket join nhiều room, tên
 * event là global nên cần channel để phân biệt).
 *
 * Channel naming (xem `@cogniva/shared/realtime` → `ch`):
 *   - `private-channel-{channelId}` · `presence-voice-{channelId}` · `presence-room-{roomId}`
 *   - `presence-user-{userId}` · `presence-group-{groupId}` · `private-dm-{threadId}`
 *
 * Lazy init + fail-open: thiếu REDIS_URL hoặc lỗi → trả `{ ok:false }`, KHÔNG throw lên route.
 */
import { Emitter } from '@socket.io/redis-emitter';
import { Redis } from 'ioredis';

let _emitter: Emitter | null = null;
let _warned = false;

function getEmitter(): Emitter | null {
  if (_emitter) return _emitter;
  const url = process.env.REDIS_URL;
  if (!url) {
    if (!_warned) {
      console.warn('[realtime] REDIS_URL trống — emit no-op (dev chưa chạy gateway/redis).');
      _warned = true;
    }
    return null;
  }
  // Connection riêng cho emitter (chỉ publish). maxRetriesPerRequest:null tránh ném lỗi
  // khi reconnect blip — giữ fail-open.
  _emitter = new Emitter(new Redis(url, { maxRetriesPerRequest: null }));
  return _emitter;
}

/**
 * Phát 1 event tới 1 channel (room). GIỮ NGUYÊN chữ ký + fail-open `{ ok, error }` để
 * ~60 call-site không phải đổi và caller tự quyết fallback nếu realtime down.
 */
export async function triggerEvent(
  channel: string,
  event: string,
  data: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const em = getEmitter();
    if (!em) return { ok: false, error: 'no-emitter' };
    // channel = arg #1 cho client lọc; data = arg #2 (payload thật).
    em.to(channel).emit(event, channel, data);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[realtime] emit fail: ${channel}/${event} — ${msg}`);
    return { ok: false, error: msg };
  }
}
