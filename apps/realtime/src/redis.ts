/**
 * Redis client cho gateway.
 *
 * 3 connection tách biệt (ioredis):
 *   - `pubClient` / `subClient` : cặp cho @socket.io/redis-adapter (sub ở chế độ
 *     subscriber KHÔNG chạy lệnh thường được → phải duplicate connection riêng).
 *   - `redis`                   : connection thường cho presence (HINCRBY/HGETALL/HDEL).
 *
 * Gateway dùng ioredis TRỰC TIẾP (không qua adapter `lib/redis.ts` của apps/web) —
 * giữ 2 codebase độc lập, gateway không cần Upstash/in-memory fallback.
 */
import IORedis from 'ioredis';

import { cfg } from './config';

export const pubClient = new IORedis(cfg.redisUrl, { maxRetriesPerRequest: null });
export const subClient = pubClient.duplicate();
export const redis = new IORedis(cfg.redisUrl);

for (const [name, client] of [
  ['pub', pubClient],
  ['sub', subClient],
  ['cmd', redis],
] as const) {
  client.on('error', (err) => console.error(`[realtime/redis:${name}]`, err.message));
}
