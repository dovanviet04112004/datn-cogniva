/**
 * BullMQ job `reconcile-leaderboard` — Phase 3 cache (2026-06-02).
 *
 * BullMQ job (chạy bởi worker; lịch/trigger ở src/queue/jobs.ts + src/worker).
 *
 * Cron rebuild ZSET `LB_XP` từ `userStats` để chống DRIFT: lbIncr cộng dồn trong
 * awardXp là best-effort fail-open (Redis có thể miss/down/restart) → ZSET dần lệch
 * DB. Job này định kỳ DEL + ZADD batch (Lua, atomic) đưa ZSET về khớp DB.
 *
 * Schedule: mỗi 30 phút. Cũng là đường "warm-up" ZSET sau deploy/flush.
 *
 * Idempotent: mỗi lần chạy đọc lại toàn bộ userStats rồi rebuild ZSET từ đầu
 * (DEL + ZADD), nên chạy lại nhiều lần cho cùng một kết quả — an toàn khi
 * BullMQ retry cả job.
 *
 * Spec: docs/plans/redis-cache.md §4.
 */
import { db, userStats } from '@cogniva/db';

import { lbBackfill } from '@/lib/cache/leaderboard';

export async function reconcileLeaderboard() {
  // Rebuild ZSET `LB_XP` từ toàn bộ userStats (DEL + ZADD batch atomic qua Lua).
  const rebuilt = await (async () => {
    const all = await db
      .select({ userId: userStats.userId, xp: userStats.xp })
      .from(userStats);
    await lbBackfill(all);
    return all.length;
  })();
  return { rebuilt };
}
