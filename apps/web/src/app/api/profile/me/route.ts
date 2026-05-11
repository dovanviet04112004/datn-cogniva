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
import { ACHIEVEMENTS } from '@/lib/gamification/achievements';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
    .where(eq(user.id, session.user.id))
    .limit(1);
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const [stats] = await db
    .select()
    .from(userStats)
    .where(eq(userStats.userId, session.user.id))
    .limit(1);

  return NextResponse.json({
    user: userRow,
    stats: stats ?? {
      userId: session.user.id,
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

  return NextResponse.json({ user: updated });
}
