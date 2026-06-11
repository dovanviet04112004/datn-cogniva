/**
 * RRF — Reciprocal Rank Fusion (Cormack et al. 2009). Port nguyên văn từ
 * apps/web/src/lib/retrieval/rrf.ts.
 *
 * Hợp nhất 2+ ranked list (vector + BM25) thành 1 list duy nhất mà KHÔNG cần
 * normalize score giữa các metric (cosine 0..1 vs ts_rank_cd — cộng trực tiếp
 * sai): RRF(d) = Σ_i 1/(k + rank_i(d)), k=60 (Cormack benchmark). Chunk xuất
 * hiện ở cả 2 list → cộng dồn contribution.
 */
import type { RetrievedChunk } from './retrieval.service';

const DEFAULT_K = 60;

export type RRFOptions = {
  /** Constant k trong công thức — 60 là default chuẩn. */
  k?: number;
  /** Số kết quả cuối cùng giữ lại sau merge. */
  topK?: number;
};

/**
 * Merge nhiều ranked list bằng RRF.
 *
 * @param lists - Mảng các list đã sort (đầu = rank 1)
 * @returns List unique chunks sort theo RRF score giảm dần
 */
export function reciprocalRankFusion(
  lists: RetrievedChunk[][],
  opts: RRFOptions = {},
): RetrievedChunk[] {
  const k = opts.k ?? DEFAULT_K;
  const topK = opts.topK ?? 30;

  // Map id → { chunk, rrfScore } — gặp lại chunk thì cộng dồn score
  const merged = new Map<string, { chunk: RetrievedChunk; score: number }>();

  for (const list of lists) {
    list.forEach((chunk, idx) => {
      const rank = idx + 1; // RRF dùng rank 1-indexed
      const contribution = 1 / (k + rank);
      const existing = merged.get(chunk.id);
      if (existing) {
        existing.score += contribution;
      } else {
        // Clone để không mutate input list
        merged.set(chunk.id, { chunk: { ...chunk }, score: contribution });
      }
    });
  }

  // Sort theo RRF score giảm dần, gán score mới rồi cắt topK
  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk, score }) => ({ ...chunk, score }));
}
