/**
 * cache-aside.ts — Nền tảng lớp cache Redis fail-open (Tier 1, SERVER-ONLY).
 *
 * Đây là 1 trong 4 module của lớp cache thống nhất (xem docs/plans/redis-cache.md):
 *   cache-aside.ts (file này) · keys.ts · invalidate.ts · leaderboard.ts
 *
 * Nguyên tắc bất biến (áp cho MỌI domain, không ngoại lệ):
 *   1. UNIFORM   — mọi read đọc-nhiều đi qua đúng `cached()` này, không cache lẻ.
 *   2. FAIL-OPEN — Redis lỗi/chết ở BẤT KỲ bước nào → vẫn trả data từ fn() (nguồn
 *      thật). Cache CHỈ là tối ưu, KHÔNG bao giờ được làm sập trang. Bám đúng
 *      pattern sẵn có (semantic-cache, rate-limit: try/catch → log warn → default an toàn).
 *   3. MOBILE (RN) SAFE — code cache server-only (đụng `getRedis` → ioredis, không
 *      bundle được xuống client). TUYỆT ĐỐI KHÔNG import vào `packages/shared`
 *      (RN-safe, chỉ zod). Mobile gọi API route → hưởng cache server-side miễn phí.
 *
 * Convention key: `domain:v{N}:...` (colon, có version để flush hàng loạt khi đổi
 * shape) — xem keys.ts.
 */
import { getRedis } from '@/lib/redis';
import { logger } from '@/lib/observability/logger';

/**
 * Cache-aside fail-open: đọc cache → miss thì gọi `fn()` (nguồn thật) → ghi lại cache.
 *
 * Redis lỗi ở bước đọc HOẶC ghi đều KHÔNG throw — luôn trả về data đúng từ `fn()`.
 * Hệ quả: tắt Redis (hoặc Redis chết) → trang vẫn chạy, chỉ chậm hơn (mỗi request
 * gọi nguồn thật như khi chưa có cache).
 *
 * @param key    Khoá cache (dùng factory `ck` ở keys.ts, đừng tự nối chuỗi rời rạc).
 * @param ttlSec TTL giây — lưới an toàn cuối khi sót invalidation; ngắn = tươi hơn.
 * @param fn     Hàm lấy data thật (Drizzle query…). Chỉ chạy khi cache MISS.
 */
export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();

  // ── Bước 1: thử đọc cache (HIT) ──────────────────────────────────────────
  try {
    const hit: unknown = await redis.get(key);
    if (hit !== null && hit !== undefined) {
      // ioredis/in-memory trả raw string → cần JSON.parse; Upstash REST auto-
      // deserialize → đã là object. Nhánh theo typeof để đúng cho cả 2 provider.
      return (typeof hit === 'string' ? JSON.parse(hit) : hit) as T;
    }
  } catch (err) {
    logger.warn('cache.read_error', { key, error: err instanceof Error ? err.message : String(err) });
  }

  // ── Bước 2: MISS → gọi nguồn thật ────────────────────────────────────────
  const data = await fn();

  // ── Bước 3: ghi cache (best-effort, không chặn kết quả) ──────────────────
  try {
    await redis.set(key, JSON.stringify(data), { ex: ttlSec });
  } catch (err) {
    logger.warn('cache.write_error', { key, error: err instanceof Error ? err.message : String(err) });
  }

  return data;
}

/**
 * Xoá 1..n key cache (best-effort — Redis lỗi chỉ log warn, không throw).
 * Gọi từ invalidate.ts tại các choke point ghi (awardXp, study-plan write…).
 */
export async function cacheDelete(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await getRedis().del(...keys);
  } catch (err) {
    logger.warn('cache.del_error', { keys, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Đọc version hiện tại của 1 nhóm cache CÔNG KHAI nhiều-key (vd catalog library).
 *
 * Cơ chế version-fold: key thật = `...:${ver}`. Khi data đổi, ta `bumpCacheVersion`
 * (incr) → mọi key cũ trở thành mồ côi (không ai đọc, tự hết TTL) mà KHÔNG cần biết
 * hết danh sách key để xoá. Fail-open: lỗi → coi như v1 (chỉ là cache mới, không sai).
 */
export async function cacheVersion(tag: string): Promise<number> {
  try {
    const v: unknown = await getRedis().get(`ver:${tag}`);
    const n = v === null || v === undefined ? NaN : Number(v);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1; // fail-open: coi như version 1
  }
}

/**
 * Tăng version của nhóm cache công khai → vô hiệu hoá cả lớp tức thì (xem cacheVersion).
 * Gọi tại choke point đổi catalog (awardKarma, doc publish/import/remix).
 */
export async function bumpCacheVersion(tag: string): Promise<void> {
  try {
    await getRedis().incr(`ver:${tag}`);
  } catch (err) {
    logger.warn('cache.bump_error', { tag, error: err instanceof Error ? err.message : String(err) });
  }
}
