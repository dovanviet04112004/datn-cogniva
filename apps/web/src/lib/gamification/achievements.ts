import { ACHIEVEMENT_META } from '@cogniva/server-core';

import type { UserStatsRow } from './xp';

export type AchievementContext = {
  source: 'flashcard' | 'quiz' | 'note' | 'document' | 'streak';
  totalCount?: number;
};

export type Achievement = {
  id: string;
  label: string;
  description: string;
  icon: string;
  check: (stats: UserStatsRow, ctx: AchievementContext) => boolean;
};

type CheckFn = Achievement['check'];

const CHECKS: Record<string, CheckFn> = {
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

export const ACHIEVEMENTS: Achievement[] = ACHIEVEMENT_META.map((m) => ({
  ...m,
  check: CHECKS[m.id] ?? (() => false),
}));

export function checkNewAchievements(stats: UserStatsRow, ctx: AchievementContext): string[] {
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

export function getAchievement(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
