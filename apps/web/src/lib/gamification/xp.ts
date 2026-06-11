import { eq } from 'drizzle-orm';

import { db, userStats } from '@cogniva/db';

import { onXpChanged } from '@/lib/cache/invalidate';

import { checkNewAchievements, type AchievementContext } from './achievements';

export type UserStatsRow = {
  userId: string;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  achievements: string[];
};

function todayString(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function computeStreak(
  lastDate: string | null,
  currentStreak: number,
): { newStreak: number; isNewDay: boolean } {
  const today = todayString();
  if (lastDate === today) return { newStreak: currentStreak, isNewDay: false };

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yString = yesterday.toISOString().slice(0, 10);

  if (lastDate === yString) return { newStreak: currentStreak + 1, isNewDay: true };
  return { newStreak: 1, isNewDay: true };
}

async function ensureStats(userId: string): Promise<UserStatsRow> {
  const [existing] = await db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1);
  if (existing) return existing;

  const [inserted] = await db.insert(userStats).values({ userId }).returning();
  if (!inserted) throw new Error('[xp] insert userStats failed');
  return inserted;
}

export async function awardXp(
  userId: string,
  amount: number,
  ctx: AchievementContext,
): Promise<{ stats: UserStatsRow; newAchievements: string[] }> {
  if (amount < 0) amount = 0;
  const current = await ensureStats(userId);
  const { newStreak } = computeStreak(current.lastActivityDate, current.currentStreak);
  const today = todayString();

  const nextStats: UserStatsRow = {
    ...current,
    xp: current.xp + amount,
    currentStreak: newStreak,
    longestStreak: Math.max(current.longestStreak, newStreak),
    lastActivityDate: today,
  };

  const unlocked = checkNewAchievements(nextStats, ctx);
  const mergedAchievements = unlocked.length
    ? [...nextStats.achievements, ...unlocked]
    : nextStats.achievements;

  const [updated] = await db
    .update(userStats)
    .set({
      xp: nextStats.xp,
      currentStreak: nextStats.currentStreak,
      longestStreak: nextStats.longestStreak,
      lastActivityDate: today,
      achievements: mergedAchievements,
      updatedAt: new Date(),
    })
    .where(eq(userStats.userId, userId))
    .returning();

  if (!updated) throw new Error('[xp] update userStats failed');

  await onXpChanged(userId, amount);

  return { stats: updated, newAchievements: unlocked };
}

export const XP_AMOUNTS = {
  FLASHCARD_REVIEW_PASS: 5,
  FLASHCARD_REVIEW_FAIL: 2,
  QUIZ_ANSWER_CORRECT: 10,
  NOTE_CREATE: 3,
  DOCUMENT_UPLOAD: 20,
} as const;
