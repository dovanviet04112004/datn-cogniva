/**
 * MMR — Maximal Marginal Relevance (Carbonell & Goldstein 1998). Port nguyên
 * văn từ apps/web/src/lib/retrieval/mmr.ts.
 *
 * Rerank giải precision nhưng top-N có thể trùng lặp (5 chunks cùng nói 1 ý).
 * MMR greedy chọn chunks vừa relevant với query vừa khác biệt với chunks đã
 * chọn: MMR(d) = λ·Sim(d,query) − (1−λ)·max_{d'∈S} Sim(d,d'), λ=0.7,
 * cosine trên embedding 1024-dim, O(n²) — n=50 → <5ms.
 */
import type { RetrievedChunk } from './retrieval.service';

/** Chunk có thêm vector embedding để tính diversity. */
export type ChunkWithEmbedding = RetrievedChunk & { embedding: number[] };

export type MMROptions = {
  /** λ — trọng số relevance (1) vs diversity (0). Default 0.7. */
  lambda?: number;
  /** Số chunk cuối cùng. Default 5. */
  topN?: number;
};

/** Cosine similarity giữa 2 vector cùng chiều. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  // Tránh chia 0 với vector zero (không nên xảy ra với embedding chuẩn)
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Lọc chunks bằng MMR greedy. Giữ score gốc trong output để debug.
 *
 * @param queryEmbedding - Vector của query (hoặc HyDE answer)
 * @param candidates     - Candidates đã rerank, có embedding
 * @returns Subset đa dạng + relevant
 */
export function mmrFilter(
  queryEmbedding: number[],
  candidates: ChunkWithEmbedding[],
  opts: MMROptions = {},
): ChunkWithEmbedding[] {
  const lambda = opts.lambda ?? 0.7;
  const topN = opts.topN ?? 5;

  if (candidates.length <= topN) return candidates.slice();

  // Pre-compute relevance score (sim với query) cho mọi candidate — dùng lại
  const relevance = candidates.map((c) => cosine(queryEmbedding, c.embedding));

  const selected: ChunkWithEmbedding[] = [];
  const remaining = new Set(candidates.map((_, i) => i));

  // Lần đầu: chọn candidate có relevance cao nhất (thuần relevance, S rỗng)
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

  // Greedy: mỗi vòng chọn candidate maximize MMR score so với S đã chọn
  while (selected.length < topN && remaining.size > 0) {
    let bestMMR = -Infinity;
    let bestPick = -1;

    for (const i of remaining) {
      const cand = candidates[i]!;
      // max similarity với chunks đã chọn
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
