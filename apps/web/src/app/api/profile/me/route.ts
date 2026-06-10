/**
 * /api/profile/me — info user hiện tại + stats gamification.
 *
 * GET: trả { user, stats, achievementMeta } cho /profile page.
 * PATCH body { isPublic? }: cập nhật visibility profile.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, user, userStats } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';
import { onProfileChanged } from '@/lib/cache/invalidate';
import { ACHIEVEMENTS } from '@/lib/gamification/achievements';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  // Cache 2 read PK (user + userStats) — StreakBadge gọi mỗi lần điều hướng nên
  // đáng cache. TTL 120s; invalidate: onXpChanged (XP/streak) + onProfileChanged
  // (đổi tên/visibility). Date field (createdAt/updatedAt) serialize→string nhưng
  // chỉ đi tiếp vào NextResponse.json (không date-math) nên không vỡ.
  const data = await cached(ck.profileMe(userId), 120, async () => {
    const [userRow] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        plan: user.plan,
        isPublic: user.isPublic,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    const [stats] = await db
      .select()
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1);
    return { user: userRow ?? null, stats: stats ?? null };
  });

  if (!data.user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  return NextResponse.json({
    user: data.user,
    stats: data.stats ?? {
      userId,
      xp: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActivityDate: null,
      achievements: [],
    },
    // Gửi metadata để client render đầy đủ (label + icon + description)
    achievementMeta: ACHIEVEMENTS,
  });
}

const PATCH_SCHEMA = z.object({
  isPublic: z.boolean().optional(),
  name: z.string().min(1).max(100).optional(),
});

export async function PATCH(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = PATCH_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(user)
    .set({
      ...(parsed.data.isPublic !== undefined && { isPublic: parsed.data.isPublic }),
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      updatedAt: new Date(),
    })
    .where(eq(user.id, session.user.id))
    .returning({
      id: user.id,
      name: user.name,
      isPublic: user.isPublic,
    });

  // Tên/visibility nằm trong cache profile → bust để GET kế tiếp thấy giá trị mới.
  await onProfileChanged(session.user.id);

  return NextResponse.json({ user: updated });
}
