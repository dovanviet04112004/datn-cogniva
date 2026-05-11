/**
 * GET /api/profile/[id] — public profile view.
 *
 * Chỉ trả info nếu user.isPublic = true; ngược lại 404 (không leak existence).
 * Auth optional — visitor không cần login để xem profile public.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, user, userStats } from '@cogniva/db';

import { ACHIEVEMENTS } from '@/lib/gamification/achievements';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [userRow] = await db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      plan: user.plan,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(and(eq(user.id, id), eq(user.isPublic, true)))
    .limit(1);
  if (!userRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [stats] = await db
    .select({
      xp: userStats.xp,
      currentStreak: userStats.currentStreak,
      longestStreak: userStats.longestStreak,
      achievements: userStats.achievements,
    })
    .from(userStats)
    .where(eq(userStats.userId, id))
    .limit(1);

  return NextResponse.json({
    user: userRow,
    stats: stats ?? { xp: 0, currentStreak: 0, longestStreak: 0, achievements: [] },
    achievementMeta: ACHIEVEMENTS,
  });
}
