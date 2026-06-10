/**
 * auth-secondary-storage.ts — Adapter Redis cho Better Auth `secondaryStorage` (SERVER-ONLY).
 *
 * Mục đích: đưa SESSION của Better Auth vào Redis (1-5ms) thay vì query Neon mỗi
 * lần `getSession()` (50-100ms warm, +1-2s cold-start). Phủ TẤT CẢ điểm gọi getSession
 * (layout + 40+ page/route + mobile qua API) cùng lúc, KHÔNG cần sửa từng chỗ.
 *
 * FAIL-OPEN (then chốt): mọi op bọc try/catch → lỗi Redis trả null/no-op. Kết hợp
 * `session.storeSessionInDatabase: true` (xem auth.ts), Better Auth `findSession`
 * (internal-adapter) khi secondaryStorage MISS sẽ **fallback đọc DB** → Redis chết
 * KHÔNG làm logout toàn bộ, chỉ chậm lại (đập DB như trước). Không có "session sống
 * sau logout" vì Better Auth tự xoá key khi signout/revoke (auto-invalidation).
 *
 * Mobile-safe: server-only, mobile (Bearer JWT) gọi getSession qua API route cũng
 * hưởng Redis này, KHÔNG đổi token flow. KHÔNG import vào packages/shared.
 *
 * Interface Better Auth gọi: get(key) → string|null, set(key,value,ttl?) → void,
 * delete(key) → void. Value là JSON string (Better Auth tự stringify/parse).
 */
import { getRedis } from '@/lib/redis';
import { logger } from '@/lib/observability/logger';

/** Namespace key Better Auth trong Redis (tránh đụng cache `domain:v1:` + rate-limit). */
const PREFIX = 'ba:';

export const redisSecondaryStorage = {
  async get(key: string): Promise<string | null> {
    try {
      const v = await getRedis().get(`${PREFIX}${key}`);
      if (v === null || v === undefined) return null;
      // ioredis/in-memory trả raw string; Upstash REST auto-deserialize → object.
      // Better Auth kỳ vọng STRING (nó JSON.parse) → stringify lại nếu lỡ thành object.
      return typeof v === 'string' ? v : JSON.stringify(v);
    } catch (err) {
      logger.warn('auth.ss.get_error', { key, error: err instanceof Error ? err.message : String(err) });
      return null; // fail-open → Better Auth fallback DB (storeSessionInDatabase=true)
    }
  },

  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      // ttl (giây) từ Better Auth = session TTL → set EX. Không ttl → lưu không hạn.
      await getRedis().set(`${PREFIX}${key}`, value, ttl ? { ex: ttl } : undefined);
    } catch (err) {
      logger.warn('auth.ss.set_error', { key, error: err instanceof Error ? err.message : String(err) });
    }
  },

  async delete(key: string): Promise<void> {
    try {
      await getRedis().del(`${PREFIX}${key}`);
    } catch (err) {
      logger.warn('auth.ss.del_error', { key, error: err instanceof Error ? err.message : String(err) });
    }
  },
};
