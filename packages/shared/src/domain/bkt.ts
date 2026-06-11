const P_INIT = 0.1;
const P_TRANSITION = 0.2;
const P_SLIP = 0.1;
const P_GUESS = 0.2;

export const INITIAL_SCORE = P_INIT;

export function updateMastery(current: number, score: number): number {
  const pL = Math.max(0.001, Math.min(0.999, current));

  const pLgivenCorrect = (pL * (1 - P_SLIP)) / (pL * (1 - P_SLIP) + (1 - pL) * P_GUESS);
  const pLgivenWrong = (pL * P_SLIP) / (pL * P_SLIP + (1 - pL) * (1 - P_GUESS));

  const s = Math.max(0, Math.min(1, score));
  const posterior = s * pLgivenCorrect + (1 - s) * pLgivenWrong;

  const newScore = posterior + (1 - posterior) * P_TRANSITION;
  return Math.max(0, Math.min(1, newScore));
}

export function decay(current: number, daysSinceSeen: number): number {
  if (daysSinceSeen <= 0) return current;
  const halfLifeDays = 14;
  const lambda = Math.LN2 / halfLifeDays;
  const decayed = current * Math.exp(-lambda * daysSinceSeen);
  return Math.max(INITIAL_SCORE, decayed);
}

export const MASTERY_MASTERED = 0.8;

export type MasteryLevel = 'new' | 'learning' | 'mastered';

export function getMasteryLevel(score: number | null | undefined): MasteryLevel {
  if (score == null) return 'new';
  if (score >= MASTERY_MASTERED) return 'mastered';
  return 'learning';
}

export const MASTERY_LEVEL_LABEL: Record<MasteryLevel, string> = {
  new: 'Chưa học',
  learning: 'Đang học',
  mastered: 'Đã nắm',
};
