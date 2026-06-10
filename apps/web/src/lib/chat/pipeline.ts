/**
 * Chat pipeline — wrapper retrieve → augment system prompt cho streamText.
 *
 * Hai chế độ retrieval (chọn qua env RETRIEVAL_MODE):
 *   - 'basic' (Phase 2): vector cosine top-K. Nhanh ~150ms, recall vừa.
 *   - 'advanced' (Phase 3, default): HyDE → hybrid (vector+BM25) → RRF →
 *     Cohere rerank → MMR. Latency ~750ms nhưng faithfulness/precision cao.
 *
 * Để debug + A/B test, mode có thể override qua opts.mode (eval runner
 * pass thẳng 'basic' hay 'advanced' để so sánh trên cùng query).
 *
 * Khi Phase 4 thêm query classification (factual/conceptual/chitchat),
 * sẽ thay route handler kiểu switch — đó là lúc Mastra workflow vào.
 */
import { embedQuery } from '@/lib/ingest/embed-query';
import { advancedRetrieve } from '@/lib/retrieval/advanced';
import { retrieveChunks, type RetrievedChunk } from '@/lib/retrieval';

import { buildSystemPrompt } from './system-prompt';

export type RetrievalMode = 'basic' | 'advanced';

export type ChatContext = {
  /** Chunks đã retrieve top-K, sort theo similarity giảm dần. */
  chunks: RetrievedChunk[];
  /** System prompt đã được augment với chunks. */
  systemPrompt: string;
  /** Latency của retrieval (ms) — phục vụ trace + dashboard P50/P95. */
  retrievalMs: number;
  /** Mode đã dùng — log + Langfuse metadata. */
  mode: RetrievalMode;
  /** HyDE hypothetical answer (chỉ khi mode='advanced'). */
  hypothetical?: string;
  /** Per-stage timings của advanced — chỉ khi mode='advanced'. */
  timings?: Record<string, number>;
};

export type BuildContextOptions = {
  query: string;
  userId: string;
  workspaceId?: string;
  /**
   * Document-level pin: nếu set, retrieval chỉ search trong các doc này
   * (ngay cả khi workspace có doc khác). User chọn qua panel "Tài liệu
   * tham chiếu" → forward từ /api/chat body.
   */
  documentIds?: string[];
  topK?: number;
  /** Override mode (mặc định lấy từ env RETRIEVAL_MODE, fallback 'advanced'). */
  mode?: RetrievalMode;
};

/** Đọc retrieval mode từ env. Default 'advanced' khi Phase 3 ship. */
export function pickRetrievalMode(): RetrievalMode {
  const env = process.env.RETRIEVAL_MODE;
  if (env === 'basic' || env === 'advanced') return env;
  return 'advanced';
}

/**
 * Build chat context cho streamText.
 *
 * @returns ChatContext kèm timings cho observability
 */
export async function buildChatContext(opts: BuildContextOptions): Promise<ChatContext> {
  const mode = opts.mode ?? pickRetrievalMode();
  const topK = opts.topK ?? 5;

  if (mode === 'advanced') {
    const start = Date.now();
    const result = await advancedRetrieve({
      query: opts.query,
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      documentIds: opts.documentIds,
      topK,
    });
    return {
      chunks: result.chunks,
      systemPrompt: buildSystemPrompt(result.chunks),
      retrievalMs: Date.now() - start,
      mode,
      hypothetical: result.hypothetical,
      timings: result.timings,
    };
  }

  // Basic mode (Phase 2 fallback)
  const start = Date.now();
  const queryEmbedding = await embedQuery(opts.query);
  const chunks = await retrieveChunks({
    queryEmbedding,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    documentIds: opts.documentIds,
    topK,
  });
  return {
    chunks,
    systemPrompt: buildSystemPrompt(chunks),
    retrievalMs: Date.now() - start,
    mode,
  };
}
