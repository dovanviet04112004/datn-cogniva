import type { RetrievedChunk } from './retrieval.service';

const DEFAULT_K = 60;

export type RRFOptions = {
  k?: number;
  topK?: number;
};

export function reciprocalRankFusion(
  lists: RetrievedChunk[][],
  opts: RRFOptions = {},
): RetrievedChunk[] {
  const k = opts.k ?? DEFAULT_K;
  const topK = opts.topK ?? 30;

  const merged = new Map<string, { chunk: RetrievedChunk; score: number }>();

  for (const list of lists) {
    list.forEach((chunk, idx) => {
      const rank = idx + 1;
      const contribution = 1 / (k + rank);
      const existing = merged.get(chunk.id);
      if (existing) {
        existing.score += contribution;
      } else {
        merged.set(chunk.id, { chunk: { ...chunk }, score: contribution });
      }
    });
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk, score }) => ({ ...chunk, score }));
}
