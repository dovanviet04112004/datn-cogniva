/**
 * Achievements — danh sách badge có thể unlock, kèm điều kiện check.
 *
 * Mỗi achievement:
 *   - id: slug ổn định, lưu vào user_stats.achievements (text[])
 *   - label/description: hiển thị UI (tiếng Việt)
 *   - icon: emoji cho gọn (không cần asset)
 *   - check(stats, ctx): boolean — quyết định có unlock dựa trên state
 *
 * `ctx` được awardXp truyền vào để check theo source:
 *   - source: 'flashcard' | 'quiz' | 'note' | 'document' | 'streak'
 *   - totalCount?: tổng số object thuộc loại đó của user (nếu cần)
 *
 * Phase 9 v1: hardcoded 10 achievement đại diện. Thêm sau nếu cần variety.
 */
import type { UserStatsRow } from './xp';

export type AchievementContext = {
  source: 'flashcard' | 'quiz' | 'note' | 'document' | 'streak';
  /** Tổng số object loại đó user đã tạo (caller query trước khi check). */
  totalCount?: number;
};

export type Achievement = {
  id: string;
  label: string;
  description: string;
  icon: string;
  check: (stats: UserStatsRow, ctx: AchievementContext) => boolean;
};

export const ACHIEVEMENTS: Achievement[] = [
  // ── Onboarding ─────────────────────────────────────
  {
    id: 'first_upload',
    label: 'Tài liệu đầu tiên',
    description: 'Upload PDF đầu tiên',
    icon: '📄',
    check: (_s, c) => c.source === 'document' && (c.totalCount ?? 0) >= 1,
  },
  {
    id: 'first_quiz',
    label: 'Quiz đầu tiên',
    description: 'Hoàn thành quiz đầu tiên',
    icon: '📝',
    check: (_s, c) => c.source === 'quiz' && (c.totalCount ?? 0) >= 1,
  },
  {
    id: 'first_note',
    label: 'Note đầu tiên',
    description: 'Tạo note đầu tiên',
    icon: '📓',
    check: (_s, c) => c.source === 'note' && (c.totalCount ?? 0) >= 1,
  },
  {
    id: 'first_flashcard',
    label: 'Flashcard đầu tiên',
    description: 'Ôn flashcard đầu tiên',
    icon: '🎴',
    check: (_s, c) => c.source === 'flashcard' && (c.totalCount ?? 0) >= 1,
  },

  // ── XP milestones ──────────────────────────────────
  {
    id: 'xp_100',
    label: 'Học viên năng nổ',
    description: 'Đạt 100 XP',
    icon: '⭐',
    check: (s) => s.xp >= 100,
  },
  {
    id: 'xp_500',
    label: 'Học bá',
    description: 'Đạt 500 XP',
    icon: '🌟',
    check: (s) => s.xp >= 500,
  },
  {
    id: 'xp_1000',
    label: 'Bậc thầy tri thức',
    description: 'Đạt 1000 XP',
    icon: '💎',
    check: (s) => s.xp >= 1000,
  },

  // ── Streak milestones ──────────────────────────────
  {
    id: 'streak_3',
    label: 'Bùng cháy 3 ngày',
    description: 'Học liên tục 3 ngày',
    icon: '🔥',
    check: (s) => s.currentStreak >= 3,
  },
  {
    id: 'streak_7',
    label: 'Tuần lễ học bá',
    description: 'Học liên tục 7 ngày',
    icon: '🚀',
    check: (s) => s.currentStreak >= 7,
  },
  {
    id: 'streak_30',
    label: 'Tháng cống hiến',
    description: 'Học liên tục 30 ngày',
    icon: '🏆',
    check: (s) => s.currentStreak >= 30,
  },
];

/**
 * Check tất cả achievements, trả về list ID mới được unlock so với danh
 * sách hiện có. Không tự update DB — caller (awardXp) sẽ làm.
 */
export function checkNewAchievements(
  stats: UserStatsRow,
  ctx: AchievementContext,
): string[] {
  const already = new Set(stats.achievements);
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (already.has(a.id)) continue;
    if (a.check(stats, ctx)) {
      unlocked.push(a.id);
    }
  }
  return unlocked;
}

/** Tra Achievement metadata theo id — cho UI render badge. */
export function getAchievement(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
