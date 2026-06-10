/**
 * leaderboard.ts — ZSET precompute cho XP leaderboard (Tier 1, server-only).
 *
 * Ý tưởng "hệ thống lớn": thay vì `ORDER BY xp DESC LIMIT N` đập DB mỗi lần tải
 * bảng xếp hạng (hot path), giữ 1 sorted set Redis `LB_XP` cộng dồn XP atomic
 * (zincrby) tại choke point `awardXp` → đọc top-N là O(log N) từ Redis.
 *
 * ⚠️ KHÁC BIỆT PROVIDER (đã verify @upstash/redis@1.38.0):
 *   - `zincrby`  : CÓ ở cả 3 client → lbIncr dùng trực tiếp trên union.
 *   - đọc top-N : Upstash KHÔNG có `zrevrange` (chỉ `zrange`+{rev}); adapter kia
 *     chỉ có `zrevrange`. Đã giải quyết bằng `zRevRangeWithScores` (redis.ts) branch
 *     theo provider → lbTop dùng helper đó.
 *   - backfill  : dùng Lua eval (DEL + ZADD batch) — atomic, 1 round-trip. InMemory
 *     không support eval → throw → fail-open (ZSET trống → caller dùng DB).
 *
 * Fail-open xuyên suốt: Redis lỗi → leaderboard vẫn chạy bằng đường DB.
 */
import { getRedis, zRevRangeWithScores } from '@/lib/redis';
import { logger } from '@/lib/observability/logger';

import { LB_XP } from './keys';

/**
 * Cộng XP atomic vào ZSET (gọi BÊN TRONG awardXp — Phase 2/3). Fail-open.
 * Dùng `zincrby` (portable cả 3 provider). An toàn populate sớm: dù đường đọc
 * (lbTop) chưa bật ở Phase 0, set vẫn được tích luỹ đúng để Phase 3 đọc ngay.
 */
export async function lbIncr(userId: string, delta: number): Promise<void> {
  try {
    await getRedis().zincrby(LB_XP, delta, userId);
  } catch (err) {
    logger.warn('lb.incr_error', { userId, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Top N (userId + score) giảm dần từ ZSET. Fail-open.
 * @returns null khi ZSET trống HOẶC lỗi → caller hiểu là "chưa có precompute" →
 *          fallback DB + (lazy) backfill. Mảng rỗng cũng coi như null (cold).
 */
export async function lbTop(n: number): Promise<Array<{ userId: string; xp: number }> | null> {
  try {
    const flat = await zRevRangeWithScores(LB_XP, n);
    if (flat.length === 0) return null;
    const out: Array<{ userId: string; xp: number }> = [];
    for (let i = 0; i < flat.length; i += 2) {
      out.push({ userId: flat[i]!, xp: Number(flat[i + 1]) });
    }
    return out;
  } catch (err) {
    logger.warn('lb.top_error', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Lua: DEL key rồi ZADD batch (score, member) — atomic rebuild trong 1 round-trip.
 * ARGV layout: [score1, member1, score2, member2, ...].
 */
const LUA_REBUILD =
  "redis.call('DEL', KEYS[1]) for i=1,#ARGV,2 do redis.call('ZADD', KEYS[1], ARGV[i], ARGV[i+1]) end return 1";

/**
 * Rebuild toàn bộ ZSET từ `userStats` (lazy khi cold + BullMQ reconcile chống drift).
 * Fail-open: lỗi (vd InMemory không support eval) → log warn, ZSET giữ trạng thái cũ
 * → caller fallback DB. KHÔNG throw.
 */
export async function lbBackfill(rows: Array<{ userId: string; xp: number }>): Promise<void> {
  try {
    const redis = getRedis();
    if (rows.length === 0) {
      await redis.del(LB_XP);
      return;
    }
    const args: string[] = [];
    for (const r of rows) {
      args.push(String(r.xp), r.userId); // ZADD: score trước, member sau
    }
    await redis.eval(LUA_REBUILD, [LB_XP], args);
  } catch (err) {
    logger.warn('lb.backfill_error', { error: err instanceof Error ? err.message : String(err) });
  }
}
