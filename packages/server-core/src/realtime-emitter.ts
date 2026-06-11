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
  _emitter = new Emitter(new Redis(url, { maxRetriesPerRequest: null }));
  return _emitter;
}

export async function triggerEvent(
  channel: string,
  event: string,
  data: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const em = getEmitter();
    if (!em) return { ok: false, error: 'no-emitter' };
    em.to(channel).emit(event, channel, data);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[realtime] emit fail: ${channel}/${event} — ${msg}`);
    return { ok: false, error: msg };
  }
}
