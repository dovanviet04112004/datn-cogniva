import { and, desc, eq, inArray } from 'drizzle-orm';

import { dbReplica, user, userStats } from '@cogniva/db';

import { lbBackfill, lbTop } from '@/lib/cache/leaderboard';

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

export async function getLeaderboard(limit = 20): Promise<LeaderboardRow[]> {
  const capped = Math.min(limit, 100);

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
      .map((r) => ({ ...r, xp: xpMap.get(r.userId) ?? 0 }))
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

  const rows = await fetchLeaderboardFromDb(capped);
  void backfillZsetFromDb();
  return rows;
}

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

async function backfillZsetFromDb(): Promise<void> {
  const all = await dbReplica
    .select({ userId: userStats.userId, xp: userStats.xp })
    .from(userStats);
  await lbBackfill(all);
}
