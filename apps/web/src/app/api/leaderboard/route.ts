/**
 * GET /api/leaderboard — top users by XP.
 *
 * Chỉ liệt kê user có isPublic = true. Trả top N (mặc định 20).
 * Không cần auth — leaderboard hiển thị cho mọi visitor.
 */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';

import { db, user, userStats } from '@cogniva/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);

  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
      xp: userStats.xp,
      currentStreak: userStats.currentStreak,
      longestStreak: userStats.longestStreak,
      achievementsCount: userStats.achievements,
    })
    .from(userStats)
    .innerJoin(user, eq(user.id, userStats.userId))
    .where(eq(user.isPublic, true))
    .orderBy(desc(userStats.xp))
    .limit(limit);

  return NextResponse.json({
    leaderboard: rows.map((r, idx) => ({
      rank: idx + 1,
      userId: r.userId,
      name: r.name,
      image: r.image,
      xp: r.xp,
      currentStreak: r.currentStreak,
      longestStreak: r.longestStreak,
      achievementsCount: r.achievementsCount?.length ?? 0,
    })),
  });
}
