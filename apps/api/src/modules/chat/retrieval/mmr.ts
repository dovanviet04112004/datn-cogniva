import type { RetrievedChunk } from './retrieval.service';

export type ChunkWithEmbedding = RetrievedChunk & { embedding: number[] };

export type MMROptions = {
  lambda?: number;
  topN?: number;
};

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function mmrFilter(
  queryEmbedding: number[],
  candidates: ChunkWithEmbedding[],
  opts: MMROptions = {},
): ChunkWithEmbedding[] {
  const lambda = opts.lambda ?? 0.7;
  const topN = opts.topN ?? 5;

  if (candidates.length <= topN) return candidates.slice();

  const relevance = candidates.map((c) => cosine(queryEmbedding, c.embedding));

  const selected: ChunkWithEmbedding[] = [];
  const remaining = new Set(candidates.map((_, i) => i));

  let bestIdx = 0;
  let bestRel = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    if (relevance[i]! > bestRel) {
      bestRel = relevance[i]!;
      bestIdx = i;
    }
  }
  selected.push(candidates[bestIdx]!);
  remaining.delete(bestIdx);

  while (selected.length < topN && remaining.size > 0) {
    let bestMMR = -Infinity;
    let bestPick = -1;

    for (const i of remaining) {
      const cand = candidates[i]!;
      let maxSim = -Infinity;
      for (const s of selected) {
        const sim = cosine(cand.embedding, s.embedding);
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = lambda * relevance[i]! - (1 - lambda) * maxSim;
      if (mmr > bestMMR) {
        bestMMR = mmr;
        bestPick = i;
      }
    }

    if (bestPick === -1) break;
    selected.push(candidates[bestPick]!);
    remaining.delete(bestPick);
  }

  return selected;
}
