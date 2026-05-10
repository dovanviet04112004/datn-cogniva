/**
 * Advanced retrieval pipeline (Phase 3) — full multi-stage RAG.
 *
 * Pipeline:
 *   1. HyDE              query → LLM sinh hypothetical answer
 *   2. Embed             embed hypothetical (không phải query gốc)
 *   3. Hybrid retrieval  vector top-30 ⊕ BM25 top-30 (parallel)
 *   4. RRF merge         hợp nhất 2 ranked list, k=60
 *   5. Cohere rerank     cross-encoder, ~50 → 15
 *   6. MMR diversity     λ=0.7, 15 → 5 (đa dạng)
 *
 * Tại sao multi-stage?
 *   - Recall: Hybrid + HyDE bắt được nhiều ngữ nghĩa hơn vector thuần.
 *   - Precision: Rerank cross-encoder vượt bi-encoder trên fine-grained relevance.
 *   - Diversity: MMR tránh đáp án "5 chunks cùng nói 1 ý" thiếu góc nhìn.
 *
 * Latency budget (Anthropic key):
 *   - HyDE LLM ~400ms · Embed ~80ms · Hybrid ~50ms · RRF <1ms · Rerank ~200ms ·
 *     MMR <5ms = ~750ms tổng (vs basic ~150ms).
 *   - Trade-off chấp nhận được vì câu trả lời streaming sau đó vẫn 2-5s.
 *
 * Failure isolation: mỗi stage có fallback graceful (HyDE → query gốc;
 * Cohere → keep input; MMR → identity nếu candidates < topN), pipeline
 * không bao giờ crash giữa chừng.
 */
import { embedQuery } from '@/lib/ingest/embed-query';

import { bm25Search } from './bm25';
import { generateHypotheticalAnswer } from './hyde';
import { retrieveChunks, type RetrievedChunk } from './index';
import { mmrFilter, type ChunkWithEmbedding } from './mmr';
import { rerankChunks } from './rerank';
import { reciprocalRankFusion } from './rrf';

export type AdvancedRetrieveOptions = {
  /** Câu hỏi gốc của user. */
  query: string;
  /** Scope theo user — bắt buộc. */
  userId: string;
  /** (Optional) lọc workspace. */
  workspaceId?: string;
  /** Số chunk cuối cùng (default 5 — match basic). */
  topK?: number;
  /**
   * Bật từng stage độc lập — phục vụ A/B test (tắt rerank để đo delta của
   * Cohere, etc.). Default tất cả đều bật.
   */
  enableHyde?: boolean;
  enableBm25?: boolean;
  enableRerank?: boolean;
  enableMmr?: boolean;
};

export type AdvancedRetrieveResult = {
  chunks: RetrievedChunk[];
  /** Latency từng stage (ms) — log để dashboard P50/P95 + debug. */
  timings: {
    hyde: number;
    embed: number;
    retrieval: number;
    rerank: number;
    mmr: number;
    total: number;
  };
  /** Nội dung HyDE answer — debug + Langfuse trace. */
  hypothetical: string;
};

const VECTOR_CANDIDATES = 30;
const BM25_CANDIDATES = 30;
const RRF_K = 60;
const RERANK_TOP = 15;
const MMR_LAMBDA = 0.7;

/**
 * Chạy full advanced pipeline. Chunks output không kèm embedding (đã strip
 * để giảm payload cho client).
 */
export async function advancedRetrieve(
  opts: AdvancedRetrieveOptions,
): Promise<AdvancedRetrieveResult> {
  const {
    query,
    userId,
    workspaceId,
    topK = 5,
    enableHyde = true,
    enableBm25 = true,
    enableRerank = true,
    enableMmr = true,
  } = opts;

  const t0 = Date.now();

  // Stage 1: HyDE
  const hypothetical = enableHyde ? await generateHypotheticalAnswer(query) : query;
  const t1 = Date.now();

  // Stage 2: Embed (dùng hypothetical thay vì query gốc — khác biệt then chốt
  // của HyDE so với baseline RAG)
  const queryEmbedding = await embedQuery(hypothetical);
  const t2 = Date.now();

  // Stage 3: Hybrid — chạy song song để tiết kiệm latency
  // includeEmbedding=true để MMR có sẵn vector tính diversity cuối pipeline
  const [vectorHits, bm25Hits] = await Promise.all([
    retrieveChunks({
      queryEmbedding,
      userId,
      workspaceId,
      topK: VECTOR_CANDIDATES,
      includeEmbedding: enableMmr,
    }),
    enableBm25
      ? bm25Search({
          query,
          userId,
          workspaceId,
          topK: BM25_CANDIDATES,
          includeEmbedding: enableMmr,
        })
      : Promise.resolve([] as RetrievedChunk[]),
  ]);
  const t3 = Date.now();

  // Stage 4: RRF merge (synchronous, micro)
  const merged = reciprocalRankFusion([vectorHits, bm25Hits], {
    k: RRF_K,
    topK: VECTOR_CANDIDATES + BM25_CANDIDATES,
  });

  // Stage 5: Cohere rerank → keep top RERANK_TOP cho MMR có chỗ cắt
  // Khi enableRerank=false hoặc Cohere không có key → giữ nguyên top RERANK_TOP
  const reranked = enableRerank
    ? await rerankChunks({ query, documents: merged, topN: RERANK_TOP })
    : merged.slice(0, RERANK_TOP);
  const t4 = Date.now();

  // Stage 6: MMR — cần embedding. Lọc chunks có embedding rồi feed.
  // Với rerank=false và không có embedding (do enableMmr=false ở step 3),
  // skip MMR và slice topK trực tiếp.
  let final: RetrievedChunk[];
  if (enableMmr) {
    const withEmbedding: ChunkWithEmbedding[] = reranked.filter(
      (c): c is ChunkWithEmbedding => Array.isArray(c.embedding),
    );
    if (withEmbedding.length >= topK) {
      const diverse = mmrFilter(queryEmbedding, withEmbedding, {
        lambda: MMR_LAMBDA,
        topN: topK,
      });
      // Strip embedding khỏi output — không expose ra client
      final = diverse.map(({ embedding: _e, ...rest }) => rest);
    } else {
      // Fallback: rerank trả ít hơn topK chunks có embedding → dùng nguyên
      final = reranked.slice(0, topK).map(({ embedding: _e, ...rest }) => rest);
    }
  } else {
    final = reranked.slice(0, topK).map(({ embedding: _e, ...rest }) => rest);
  }
  const t5 = Date.now();

  return {
    chunks: final,
    hypothetical,
    timings: {
      hyde: t1 - t0,
      embed: t2 - t1,
      retrieval: t3 - t2,
      rerank: t4 - t3,
      mmr: t5 - t4,
      total: t5 - t0,
    },
  };
}
