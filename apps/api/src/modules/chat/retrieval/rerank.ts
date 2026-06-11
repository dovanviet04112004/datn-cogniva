import type { RetrievedChunk } from './retrieval.service';

const RERANK_MODEL = 'rerank-multilingual-v3.0';

export type RerankOptions = {
  query: string;
  documents: RetrievedChunk[];
  topN?: number;
};

interface CohereRerankResponse {
  results?: Array<{ index: number; relevance_score: number }>;
}

export async function rerankChunks(opts: RerankOptions): Promise<RetrievedChunk[]> {
  const { query, documents, topN = 8 } = opts;
  if (documents.length === 0) return [];

  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
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

    return result.results.map((r) => {
      const original = documents[r.index]!;
      return { ...original, score: r.relevance_score };
    });
  } catch (err) {
    console.warn('[rerank] Cohere call failed, fallback to original ranking:', err);
    return documents.slice(0, topN);
  }
}

export function isRerankAvailable(): boolean {
  return Boolean(process.env.COHERE_API_KEY);
}
