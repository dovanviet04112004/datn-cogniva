/**
 * XpService — XP + Streak engine, port từ apps/web/src/lib/gamification/
 * {xp,achievements}.ts. Choke point gamification: mọi route thưởng XP
 * (flashcard/quiz/note/upload) đều gọi awardXp → hook onXpChanged 1 chỗ
 * bust profile + dashboard cache + cộng ZSET leaderboard cho TẤT CẢ.
 *
 * XP rules (Phase 9 v1): xem XP_AMOUNTS. Streak: hôm nay giữ nguyên,
 * hôm qua +1, khác → reset 1; longestStreak update max.
 *
 * Race condition: 2 activity cùng lúc → UPDATE đè nhau, có thể mất 1-2 XP.
 * Chấp nhận như lib cũ (Phase 9 v1).
 */
import { Injectable } from '@nestjs/common';
import { ACHIEVEMENT_META } from '@cogniva/server-core';
import { onXpChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';

/** XP awards predefined theo source — dùng trong route handlers (giá trị y lib cũ). */
export const XP_AMOUNTS = {
  FLASHCARD_REVIEW_PASS: 5,
  FLASHCARD_REVIEW_FAIL: 2,
  QUIZ_ANSWER_CORRECT: 10,
  NOTE_CREATE: 3,
  DOCUMENT_UPLOAD: 20,
} as const;

/** Shape stats trả caller — camelCase khớp UserStatsRow của lib web cũ. */
export type UserStatsRow = {
  userId: string;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  achievements: string[];
};

export type AchievementContext = {
  source: 'flashcard' | 'quiz' | 'note' | 'document' | 'streak';
  /** Tổng số object loại đó user đã tạo (caller query trước khi check). */
  totalCount?: number;
};

/** Logic unlock theo id — metadata (label/icon) ở ACHIEVEMENT_META (server-core). */
const ACHIEVEMENT_CHECKS: Record<string, (s: UserStatsRow, c: AchievementContext) => boolean> = {
  first_upload: (_s, c) => c.source === 'document' && (c.totalCount ?? 0) >= 1,
  first_quiz: (_s, c) => c.source === 'quiz' && (c.totalCount ?? 0) >= 1,
  first_note: (_s, c) => c.source === 'note' && (c.totalCount ?? 0) >= 1,
  first_flashcard: (_s, c) => c.source === 'flashcard' && (c.totalCount ?? 0) >= 1,
  xp_100: (s) => s.xp >= 100,
  xp_500: (s) => s.xp >= 500,
  xp_1000: (s) => s.xp >= 1000,
  streak_3: (s) => s.currentStreak >= 3,
  streak_7: (s) => s.currentStreak >= 7,
  streak_30: (s) => s.currentStreak >= 30,
};

@Injectable()
export class XpService {
  constructor(private readonly prisma: PrismaService) {}

  /** YYYY-MM-DD (UTC) — đủ cho v1, không quá khác giờ VN +7 (như lib cũ). */
  private todayString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Tính streak mới: hôm nay giữ nguyên, hôm qua +1, còn lại reset về 1. */
  private computeStreak(lastDate: string | null, currentStreak: number): number {
    const today = this.todayString();
    if (lastDate === today) return currentStreak;

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    if (lastDate === yesterday.toISOString().slice(0, 10)) return currentStreak + 1;
    return 1;
  }

  /** Đảm bảo có row user_stats — upsert idempotent. */
  private async ensureStats(userId: string): Promise<UserStatsRow> {
    const row =
      (await this.prisma.user_stats.findUnique({ where: { user_id: userId } })) ??
      (await this.prisma.user_stats.create({ data: { user_id: userId } }));
    return {
      userId: row.user_id,
      xp: row.xp,
      currentStreak: row.current_streak,
      longestStreak: row.longest_streak,
      lastActivityDate: row.last_activity_date,
      achievements: row.achievements,
    };
  }

  /** Check toàn bộ achievements, trả list id MỚI unlock so với list hiện có. */
  private checkNewAchievements(stats: UserStatsRow, ctx: AchievementContext): string[] {
    const already = new Set(stats.achievements);
    const unlocked: string[] = [];
    for (const meta of ACHIEVEMENT_META) {
      if (already.has(meta.id)) continue;
      const check = ACHIEVEMENT_CHECKS[meta.id];
      if (check && check(stats, ctx)) unlocked.push(meta.id);
    }
    return unlocked;
  }

  /**
   * Award XP + cập nhật streak + check achievement.
   *
   * @param userId - User nhận XP
   * @param amount - Số XP cộng (luôn ≥ 0)
   * @param ctx    - Source + count để check achievement
   * @returns      - Stats sau update + list achievement mới unlock
   */
  async awardXp(
    userId: string,
    amount: number,
    ctx: AchievementContext,
  ): Promise<{ stats: UserStatsRow; newAchievements: string[] }> {
    if (amount < 0) amount = 0;
    const current = await this.ensureStats(userId);
    const newStreak = this.computeStreak(current.lastActivityDate, current.currentStreak);
    const today = this.todayString();

    const nextStats: UserStatsRow = {
      ...current,
      xp: current.xp + amount,
      currentStreak: newStreak,
      longestStreak: Math.max(current.longestStreak, newStreak),
      lastActivityDate: today,
    };

    // Check achievement TRƯỚC khi persist — merge vào UPDATE cùng câu.
    const unlocked = this.checkNewAchievements(nextStats, ctx);
    const merged = unlocked.length ? [...nextStats.achievements, ...unlocked] : nextStats.achievements;

    const updated = await this.prisma.user_stats.update({
      where: { user_id: userId },
      data: {
        xp: nextStats.xp,
        current_streak: nextStats.currentStreak,
        longest_streak: nextStats.longestStreak,
        last_activity_date: today,
        achievements: merged,
        updated_at: new Date(),
      },
    });

    // Choke point: bust profile/dashboard + cộng ZSET leaderboard.
    // Fail-open (Redis lỗi không làm hỏng award).
    await onXpChanged(userId, amount);

    return {
      stats: {
        userId: updated.user_id,
        xp: updated.xp,
        currentStreak: updated.current_streak,
        longestStreak: updated.longest_streak,
        lastActivityDate: updated.last_activity_date,
        achievements: updated.achievements,
      },
      newAchievements: unlocked,
    };
  }
}
