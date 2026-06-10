/**
 * getLeaderboard — top user theo XP (chỉ user công khai profile).
 *
 * Phase 3 precompute: đọc thứ hạng từ ZSET Redis `LB_XP` (O(log N), cộng dồn atomic
 * trong awardXp qua `lbIncr`) thay vì `ORDER BY xp` quét DB mỗi lần. ZSET chứa MỌI
 * user (kể cả private) → đọc dư buffer ×3 rồi hydrate user + lọc isPublic.
 *
 * Fail-open nhiều lớp: ZSET trống/lỗi → fallback đường DB gốc (index `userStats.xp`)
 * + lazy backfill ZSET (fire-and-forget). Worst case = hành vi cũ (query DB).
 *
 * 1 nguồn dùng chung route `/api/leaderboard` (mobile) LẪN trang SSR. Server-only.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';

import { dbReplica, user, userStats } from '@cogniva/db';

import { lbBackfill, lbTop } from '@/lib/cache/leaderboard';

/** 1 dòng bảng xếp hạng — rank tính sẵn theo thứ tự XP giảm dần. */
export type LeaderboardRow = {
  rank: number;
  userId: string;
  name: string | null;
  image: string | null;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  achievementsCount: number;
};

/**
 * @param limit số dòng tối đa (mặc định 20, trần 100 — chống over-fetch).
 */
export async function getLeaderboard(limit = 20): Promise<LeaderboardRow[]> {
  const capped = Math.min(limit, 100);

  // 1) ZSET trước. Buffer ×3 bù lọc isPublic + user đã xoá.
  const top = await lbTop(capped * 3);
  if (top && top.length > 0) {
    const ids = top.map((t) => t.userId);
    const xpMap = new Map(top.map((t) => [t.userId, t.xp]));
    const hydrated = await dbReplica
      .select({
        userId: user.id,
        name: user.name,
        image: user.image,
        currentStreak: userStats.currentStreak,
        longestStreak: userStats.longestStreak,
        achievements: userStats.achievements,
      })
      .from(userStats)
      .innerJoin(user, eq(user.id, userStats.userId))
      .where(and(inArray(user.id, ids), eq(user.isPublic, true)));

    const sorted = hydrated
      .map((r) => ({ ...r, xp: xpMap.get(r.userId) ?? 0 })) // dùng XP "live" từ ZSET
      .sort((a, b) => b.xp - a.xp)
      .slice(0, capped);

    return sorted.map((r, idx) => ({
      rank: idx + 1,
      userId: r.userId,
      name: r.name,
      image: r.image,
      xp: r.xp,
      currentStreak: r.currentStreak,
      longestStreak: r.longestStreak,
      achievementsCount: r.achievements?.length ?? 0,
    }));
  }

  // 2) ZSET cold/lỗi → DB gốc + lazy backfill (fire-and-forget, không chặn response).
  const rows = await fetchLeaderboardFromDb(capped);
  void backfillZsetFromDb();
  return rows;
}

/** Đường DB gốc (index `userStats.xp`) — fallback khi ZSET chưa sẵn sàng. */
async function fetchLeaderboardFromDb(capped: number): Promise<LeaderboardRow[]> {
  const rows = await dbReplica
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
      xp: userStats.xp,
      currentStreak: userStats.currentStreak,
      longestStreak: userStats.longestStreak,
      achievements: userStats.achievements,
    })
    .from(userStats)
    .innerJoin(user, eq(user.id, userStats.userId))
    .where(eq(user.isPublic, true))
    .orderBy(desc(userStats.xp))
    .limit(capped);

  return rows.map((r, idx) => ({
    rank: idx + 1,
    userId: r.userId,
    name: r.name,
    image: r.image,
    xp: r.xp,
    currentStreak: r.currentStreak,
    longestStreak: r.longestStreak,
    achievementsCount: r.achievements?.length ?? 0,
  }));
}

/** Backfill ZSET từ TOÀN BỘ userStats (lọc public ở read, không ở đây). */
async function backfillZsetFromDb(): Promise<void> {
  const all = await dbReplica
    .select({ userId: userStats.userId, xp: userStats.xp })
    .from(userStats);
  await lbBackfill(all);
}
