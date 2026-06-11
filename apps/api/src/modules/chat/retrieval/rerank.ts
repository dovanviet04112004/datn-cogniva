/**
 * Cohere rerank — cross-encoder đọc QUERY + DOC cùng lúc, precision sâu hơn
 * bi-encoder. Port từ apps/web/src/lib/retrieval/rerank.ts; khác bản web:
 * gọi REST trực tiếp thay SDK cohere-ai (apps/api không cài SDK đó) —
 * request/response shape giữ nguyên (model rerank-multilingual-v3.0, query
 * GỐC không phải hypothetical).
 *
 * Graceful degradation: không có COHERE_API_KEY hoặc API lỗi → trả
 * documents.slice(0, topN) — fail-open, pipeline không crash.
 */
import type { RetrievedChunk } from './retrieval.service';

const RERANK_MODEL = 'rerank-multilingual-v3.0';

export type RerankOptions = {
  /** Query gốc (không phải hypothetical answer) — Cohere rerank cần intent thật. */
  query: string;
  /** Candidate set từ hybrid retrieval — thường 30-50 docs. */
  documents: RetrievedChunk[];
  /** Số chunk giữ lại sau rerank (default 8). */
  topN?: number;
};

/** Response shape REST /v1/rerank — SDK camelCase hoá field này. */
interface CohereRerankResponse {
  results?: Array<{ index: number; relevance_score: number }>;
}

/**
 * Rerank candidate set theo độ liên quan với query.
 *
 * @returns Chunks đã sort lại theo Cohere relevance score [0,1]
 */
export async function rerankChunks(opts: RerankOptions): Promise<RetrievedChunk[]> {
  const { query, documents, topN = 8 } = opts;
  if (documents.length === 0) return [];

  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    // Không có key → return top-N theo thứ tự sẵn có (assume hybrid đã ranked)
    return documents.slice(0, topN);
  }

  try {
    const res = await fetch('https://api.cohere.com/v1/rerank', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: RERANK_MODEL,
        query,
        documents: documents.map((d) => d.content),
        top_n: Math.min(topN, documents.length),
      }),
    });
    if (!res.ok) throw new Error(`cohere rerank ${res.status}`);
    const result = (await res.json()) as CohereRerankResponse;
    if (!Array.isArray(result.results)) throw new Error('cohere rerank response thiếu results');

    // results[].index trỏ về vị trí trong array `documents` đã gửi
    return result.results.map((r) => {
      const original = documents[r.index]!;
      return { ...original, score: r.relevance_score };
    });
  } catch (err) {
    console.warn('[rerank] Cohere call failed, fallback to original ranking:', err);
    return documents.slice(0, topN);
  }
}

/** Check có sẵn key Cohere không — dùng cho health check hoặc UI badge. */
export function isRerankAvailable(): boolean {
  return Boolean(process.env.COHERE_API_KEY);
}
