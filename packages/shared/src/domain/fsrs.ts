export type FsrsFields = {
  difficulty: number;
  stability: number;
  retrievability: number;
  state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
  due: Date;
  lastReview: Date | null;
};

export function computeRetrievability(fields: FsrsFields, now: Date = new Date()): number {
  if (fields.stability <= 0 || !fields.lastReview) return 1;
  const elapsedDays = (now.getTime() - fields.lastReview.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-elapsedDays / (9 * fields.stability));
}
