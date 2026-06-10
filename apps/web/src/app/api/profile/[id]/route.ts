/**
 * GET /api/profile/[id] — public profile view.
 *
 * Chỉ trả info nếu user.isPublic = true; ngược lại 404 (không leak existence).
 * Auth optional — visitor không cần login để xem profile public.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

// dbReplica: read thuần (profile của user KHÁC, không read-your-own-write) → tách tải khỏi primary.
import { dbReplica, user, userStats } from '@cogniva/db';

import { ACHIEVEMENTS } from '@/lib/gamification/achievements';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Cache-aside per-user (public): nhiều visitor chung 1 share link → cache 5' (300s).
  // Invalidation đã được phủ tại choke point: onXpChanged (XP/streak đổi) + onProfileChanged
  // (đổi tên/visibility) đều xoá ck.profilePublic(id) — KHÔNG cần wire thêm ở đây.
  // FAIL-OPEN sẵn trong cached() → không bọc try/catch.
  // createdAt là Date nhưng chỉ đi vào JSON (NextResponse.json) → để serialize thành string,
  // page client tự re-hydrate qua new Date(...). KHÔNG cần re-hydrate Date ở đây.
  const payload = await cached(ck.profilePublic(id), 300, async () => {
    const [userRow] = await dbReplica
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
    // null khi không tồn tại / private → cache cả giá trị null (tránh stampede tra DB liên tục).
    if (!userRow) return null;

    const [stats] = await dbReplica
      .select({
        xp: userStats.xp,
        currentStreak: userStats.currentStreak,
        longestStreak: userStats.longestStreak,
        achievements: userStats.achievements,
      })
      .from(userStats)
      .where(eq(userStats.userId, id))
      .limit(1);

    return {
      user: userRow,
      stats: stats ?? { xp: 0, currentStreak: 0, longestStreak: 0, achievements: [] },
    };
  });

  // Không leak existence: user private/không tồn tại → 404 (giống behavior cũ).
  if (!payload) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // achievementMeta là hằng số static (ACHIEVEMENTS) → ghép NGOÀI cache, không tốn chỗ Redis.
  return NextResponse.json({ ...payload, achievementMeta: ACHIEVEMENTS });
}
