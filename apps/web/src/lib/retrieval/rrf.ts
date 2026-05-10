/**
 * RRF — Reciprocal Rank Fusion (Cormack et al. 2009).
 *
 * Mục đích: hợp nhất 2+ ranked list (vector + BM25) thành 1 list duy nhất
 * mà KHÔNG cần normalize score giữa các metric. Score gốc khác đơn vị
 * (cosine sim 0..1 vs BM25 rank tỉ lệ TF-IDF) → cộng trực tiếp sai.
 *
 * Công thức:
 *   RRF(d) = Σ_i  1 / (k + rank_i(d))
 *
 *   - rank_i(d) = vị trí 1-indexed của doc d trong list i (∞ nếu không có)
 *   - k = constant, mặc định 60 (Cormack benchmark) — giảm thì list rank cao
 *     dominates, tăng thì pha trộn đều hơn
 *
 * Ưu điểm so với weighted score:
 *   - Robust với outlier score (1 list có chunk score 0.99, list khác 0.01 →
 *     RRF không bị 1 list lấn át)
 *   - Không cần biết score range của metric (chỉ cần thứ tự rank)
 *   - Đã được benchmark vượt nhiều phương pháp normalize phức tạp
 *
 * Đầu ra giữ shape RetrievedChunk gốc — score thay bằng RRF score để pipeline
 * sau (rerank, MMR) có thể dùng tiếp.
 */
import type { RetrievedChunk } from './index';

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
