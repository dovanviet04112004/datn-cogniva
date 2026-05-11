/**
 * XP + Streak engine — gọi `awardXp` sau mỗi activity của user.
 *
 * XP rules (Phase 9 v1):
 *   - Flashcard review rating ≥ 3 (Good/Easy): +5 XP
 *   - Flashcard review rating < 3 (Again/Hard): +2 XP (vẫn được điểm vì đã ôn)
 *   - Quiz answer correct (score ≥ 0.5): +10 XP
 *   - Note tạo mới: +3 XP
 *   - Document upload thành công: +20 XP
 *
 * Streak rule:
 *   - lastActivityDate = today → giữ nguyên streak
 *   - = yesterday → streak +1
 *   - khác → reset về 1
 *   - longestStreak update max
 *
 * Race condition: 2 activity cùng lúc → UPDATE đè nhau, có thể mất 1-2 XP.
 * Chấp nhận (Phase 9 v1). Phase 10+ dùng row-level lock hoặc atomic SQL.
 */
import { eq } from 'drizzle-orm';

import { db, userStats } from '@cogniva/db';

import { checkNewAchievements, type AchievementContext } from './achievements';

export type UserStatsRow = {
  userId: string;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  achievements: string[];
};

/** YYYY-MM-DD theo timezone server (Asia/Bangkok ~ Asia/Ho_Chi_Minh). */
function todayString(): string {
  const d = new Date();
  // toISOString rồi cắt — đủ cho v1 (UTC), không quá khác giờ VN +7
  return d.toISOString().slice(0, 10);
}

/** Tính streak mới dựa trên lastActivityDate vs today. */
function computeStreak(
  lastDate: string | null,
  currentStreak: number,
): { newStreak: number; isNewDay: boolean } {
  const today = todayString();
  if (lastDate === today) return { newStreak: currentStreak, isNewDay: false };

  // Kiểm tra yesterday
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yString = yesterday.toISOString().slice(0, 10);

  if (lastDate === yString) return { newStreak: currentStreak + 1, isNewDay: true };
  // Khác → reset (kể cả khi lastDate null, lần đầu)
  return { newStreak: 1, isNewDay: true };
}

/** Đảm bảo có row user_stats — upsert idempotent. */
async function ensureStats(userId: string): Promise<UserStatsRow> {
  const [existing] = await db
    .select()
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1);
  if (existing) return existing;

  const [inserted] = await db
    .insert(userStats)
    .values({ userId })
    .returning();
  if (!inserted) throw new Error('[xp] insert userStats failed');
  return inserted;
}

/**
 * Award XP + cập nhật streak + check achievement.
 *
 * @param userId - User nhận XP
 * @param amount - Số XP cộng (luôn ≥ 0)
 * @param ctx    - Source + count để check achievement
 * @returns      - Stats sau update + list achievement mới unlock
 */
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

  // Check achievement TRƯỚC khi persist — để có thể merge vào UPDATE cùng câu
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
  return { stats: updated, newAchievements: unlocked };
}

/** XP awards predefined theo source — dùng trong route handlers. */
export const XP_AMOUNTS = {
  FLASHCARD_REVIEW_PASS: 5,
  FLASHCARD_REVIEW_FAIL: 2,
  QUIZ_ANSWER_CORRECT: 10,
  NOTE_CREATE: 3,
  DOCUMENT_UPLOAD: 20,
} as const;
