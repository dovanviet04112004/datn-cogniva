/**
 * Cohere rerank — chuyển từ "ranking từ retrieve thô" sang "ranking dựa
 * trên cross-encoder đọc cả query lẫn content cùng lúc".
 *
 * Vì sao thêm rerank sau hybrid?
 *   - Retrieval (vector + BM25) là bi-encoder: query và doc embed riêng,
 *     so sánh bằng inner product → nhanh, scale, nhưng coarse ranking.
 *   - Rerank là cross-encoder: model đọc QUERY + DOC concat, đầu ra 1 score
 *     kiểu "doc này trả lời query tốt thế nào" → ngữ nghĩa sâu hơn nhiều.
 *   - Cohere rerank-multilingual-v3.0 hỗ trợ tiếng Việt + 100+ ngôn ngữ.
 *
 * Trade-off:
 *   - Latency: ~150-300ms/query với top 50 docs
 *   - Cost: $1/1000 search (free tier 1000/tháng đủ dev)
 *   - Mất song song hoá nếu thay 1 stage retrieve thuần — nhưng giá trị
 *     precision@k là rất rõ trên benchmark MTEB.
 *
 * Graceful degradation:
 *   - Không có COHERE_API_KEY → trả nguyên list (skip rerank stage).
 *     Pipeline vẫn chạy được trong dev / khi user chưa setup key.
 *   - Cohere API lỗi → log + return list gốc thay vì crash request.
 */
import { CohereClient } from 'cohere-ai';

import type { RetrievedChunk } from './index';

const RERANK_MODEL = 'rerank-multilingual-v3.0';

let _cohere: CohereClient | undefined;

/**
 * Lazy init Cohere client. Trả undefined nếu env không có key.
 * Gọi lại nhiều lần an toàn — chỉ khởi tạo 1 lần.
 */
function getCohere(): CohereClient | undefined {
  if (_cohere) return _cohere;
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) return undefined;
  _cohere = new CohereClient({ token: apiKey });
  return _cohere;
}

export type RerankOptions = {
  /** Query gốc (không phải hypothetical answer) — Cohere rerank cần intent thật. */
  query: string;
  /** Candidate set từ hybrid retrieval — thường 30-50 docs. */
  documents: RetrievedChunk[];
  /** Số chunk giữ lại sau rerank (default 8). */
  topN?: number;
};

/**
 * Rerank candidate set theo độ liên quan với query.
 *
 * @returns Chunks đã sort lại theo Cohere relevance score [0,1]
 */
export async function rerankChunks(opts: RerankOptions): Promise<RetrievedChunk[]> {
  const { query, documents, topN = 8 } = opts;
  if (documents.length === 0) return [];

  const cohere = getCohere();
  if (!cohere) {
    // Không có key → return top-N theo thứ tự sẵn có (assume hybrid đã ranked)
    return documents.slice(0, topN);
  }

  try {
    const result = await cohere.rerank({
      model: RERANK_MODEL,
      query,
      documents: documents.map((d) => d.content),
      topN: Math.min(topN, documents.length),
    });

    // result.results: [{ index, relevanceScore }]
    // index trỏ về vị trí trong array `documents` đã gửi
    return result.results.map((r) => {
      const original = documents[r.index]!;
      return { ...original, score: r.relevanceScore };
    });
  } catch (err) {
    console.warn('[rerank] Cohere call failed, fallback to original ranking:', err);
    return documents.slice(0, topN);
  }
}

/** Check có sẵn key Cohere không — dùng cho /api/health hoặc UI badge. */
export function isRerankAvailable(): boolean {
  return Boolean(process.env.COHERE_API_KEY);
}
