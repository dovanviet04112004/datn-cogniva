/**
 * Achievement metadata — phần TĨNH (id/label/description/icon) dùng chung
 * giữa web (lib/gamification ghép thêm check()) và api (trả `achievementMeta`).
 * Client (web/mobile UI) nhận qua API response, KHÔNG import trực tiếp —
 * vì vậy đặt ở server-core (CJS) thay vì @cogniva/shared (ESM RN-safe).
 */
export type AchievementMeta = {
  id: string;
  label: string;
  description: string;
  icon: string;
};

export const ACHIEVEMENT_META: AchievementMeta[] = [
  // ── Onboarding ─────────────────────────────────────
  { id: 'first_upload', label: 'Tài liệu đầu tiên', description: 'Upload PDF đầu tiên', icon: '📄' },
  { id: 'first_quiz', label: 'Quiz đầu tiên', description: 'Hoàn thành quiz đầu tiên', icon: '📝' },
  { id: 'first_note', label: 'Note đầu tiên', description: 'Tạo note đầu tiên', icon: '📓' },
  { id: 'first_flashcard', label: 'Flashcard đầu tiên', description: 'Ôn flashcard đầu tiên', icon: '🎴' },
  // ── XP milestones ──────────────────────────────────
  { id: 'xp_100', label: 'Học viên năng nổ', description: 'Đạt 100 XP', icon: '⭐' },
  { id: 'xp_500', label: 'Học bá', description: 'Đạt 500 XP', icon: '🌟' },
  { id: 'xp_1000', label: 'Bậc thầy tri thức', description: 'Đạt 1000 XP', icon: '💎' },
  // ── Streak milestones ──────────────────────────────
  { id: 'streak_3', label: 'Bùng cháy 3 ngày', description: 'Học liên tục 3 ngày', icon: '🔥' },
  { id: 'streak_7', label: 'Tuần lễ học bá', description: 'Học liên tục 7 ngày', icon: '🚀' },
  { id: 'streak_30', label: 'Tháng cống hiến', description: 'Học liên tục 30 ngày', icon: '🏆' },
];
