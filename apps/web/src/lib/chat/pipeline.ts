/**
 * Chat pipeline — wrapper retrieve → augment system prompt cho streamText.
 *
 * Phase 2 v1 chỉ có 1 strategy: linear (retrieve → generate). Khi Phase 3
 * thêm query classification + HyDE + reranking, hàm này sẽ chia thành
 * nhiều branch (factual / conceptual / chitchat) — đó là lúc Mastra workflow
 * giá trị thật sự (state machine quản lý transition).
 *
 * Hiện tại return về context (chunks + system prompt) để route handler
 * gọi streamText — tách phần "retrieval" và "generation" để Phase 3 dễ
 * trace bằng Langfuse + A/B test.
 */
import { embedQuery } from '@/lib/ingest/embed-query';
import { retrieveChunks, type RetrievedChunk } from '@/lib/retrieval';

import { buildSystemPrompt } from './system-prompt';

export type ChatContext = {
  /** Chunks đã retrieve top-K, sort theo similarity giảm dần. */
  chunks: RetrievedChunk[];
  /** System prompt đã được augment với chunks. */
  systemPrompt: string;
  /** Latency của retrieval (ms) — phục vụ trace + dashboard P50/P95. */
  retrievalMs: number;
};

export type BuildContextOptions = {
  query: string;
  userId: string;
  workspaceId?: string;
  topK?: number;
};

/**
 * Embed query → vector search → build system prompt với context.
 *
 * @returns ChatContext sẵn dùng cho streamText
 */
export async function buildChatContext(opts: BuildContextOptions): Promise<ChatContext> {
  const start = Date.now();
  const queryEmbedding = await embedQuery(opts.query);
  const chunks = await retrieveChunks({
    queryEmbedding,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    topK: opts.topK ?? 5,
  });
  const retrievalMs = Date.now() - start;
  const systemPrompt = buildSystemPrompt(chunks);
  return { chunks, systemPrompt, retrievalMs };
}
