/**
 * Kết nối Redis cho BullMQ.
 *
 * BullMQ yêu cầu `maxRetriesPerRequest: null` (dùng blocking command BRPOPLPUSH) →
 * KHÔNG tái dùng được `IoRedisAdapter` của cache (`lib/redis.ts` set =2). Đây là
 * connection RIÊNG nhưng trỏ CÙNG Redis instance (REDIS_URL) với cache + Socket.IO
 * adapter + Better Auth session → không fork Redis mới.
 *
 * Server-only: file này (và mọi thứ trong `queue/`, `worker/`, `jobs/`) chỉ chạy ở
 * apps/web (Next routes + worker process). TUYỆT ĐỐI không import vào packages/shared
 * hay apps/mobile (giữ RN-safe).
 */
import IORedis, { type Redis } from 'ioredis';

/** Tạo connection mới (Worker cần connection riêng vì blocking). */
export function makeBullConnection(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('[queue] REDIS_URL bắt buộc cho BullMQ');
  return new IORedis(url, { maxRetriesPerRequest: null });
}

let _shared: Redis | null = null;

/** Connection dùng chung cho phía PRODUCER (enqueue) — nhiều Queue share được. */
export function sharedConnection(): Redis {
  if (!_shared) _shared = makeBullConnection();
  return _shared;
}
