/**
 * RetrievalService — full RAG pipeline cho chat, port từ apps/web/src/lib:
 *   retrieval/index.ts (vector pgvector) + retrieval/bm25.ts (Postgres FTS) +
 *   retrieval/advanced.ts (orchestrator) + chat/pipeline.ts (buildChatContext)
 *   + chat/system-prompt.ts (buildSystemPrompt).
 *
 * Pipeline advanced (default mọi chat, RETRIEVAL_MODE=basic để về vector thuần):
 *   1. HyDE        query → LLM sinh hypothetical answer (router ragChat)
 *   2. Embed       embed HYPOTHETICAL (không phải query gốc) — Voyage inputType 'query'
 *   3. Hybrid      vector top-30 ⊕ BM25 top-30 (song song)
 *   4. RRF merge   k=60
 *   5. Cohere      rerank cross-encoder → top-15 (REST, fail-open)
 *   6. MMR         λ=0.7 → top-5 đa dạng, strip embedding khỏi output
 *
 * Failure isolation giữ nguyên web: mỗi stage fallback graceful, pipeline
 * không crash giữa chừng. SQL qua Prisma $queryRaw — semantics + filter
 * (user_id + status READY + workspace + documentIds) copy nguyên Drizzle cũ.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import { EmbeddingService } from '../../../infra/ai/embedding.service';
import { RouterService } from '../../../infra/ai/router.service';
import type { Plan } from '../../../infra/ai/cost-guardrail.service';

import { generateHypotheticalAnswer } from './hyde';
import { mmrFilter, type ChunkWithEmbedding } from './mmr';
import { rerankChunks } from './rerank';
import { reciprocalRankFusion } from './rrf';

export type RetrievedChunk = {
  /** ID chunk trong DB. */
  id: string;
  /** Nội dung chunk. */
  content: string;
  /** ID document gốc — dùng để load file/metadata khi UI cần. */
  documentId: string;
  /** Tên file để hiển thị citation. */
  filename: string;
  /** Trang trong PDF (1-indexed) nếu có. */
  page: number | null;
  /** Cosine similarity score (0..1) — hoặc score từ stage hiện tại. */
  score: number;
  /** Embedding 1024-dim — chỉ có khi includeEmbedding=true (cho MMR). */
  embedding?: number[];
};

export type RetrievalMode = 'basic' | 'advanced';

export type ChatContext = {
  /** Chunks đã retrieve top-K, sort theo similarity giảm dần. */
  chunks: RetrievedChunk[];
  /** System prompt đã được augment với chunks. */
  systemPrompt: string;
  /** Latency của retrieval (ms). */
  retrievalMs: number;
  /** Mode đã dùng. */
  mode: RetrievalMode;
  /** HyDE hypothetical answer (chỉ khi mode='advanced'). */
  hypothetical?: string;
  /** Per-stage timings của advanced — chỉ khi mode='advanced'. */
  timings?: Record<string, number>;
};

export type BuildContextOptions = {
  query: string;
  userId: string;
  /** Plan của user — HyDE đi qua router nên cần cho guardrail. */
  plan: Plan;
  workspaceId?: string;
  /** Document-level pin: retrieval chỉ search trong các doc này. */
  documentIds?: string[];
  topK?: number;
  /** Override mode (mặc định env RETRIEVAL_MODE, fallback 'advanced'). */
  mode?: RetrievalMode;
};

type RetrieveOptions = {
  queryEmbedding: number[];
  userId: string;
  topK?: number;
  workspaceId?: string;
  documentIds?: string[];
  includeEmbedding?: boolean;
};

type AdvancedRetrieveResult = {
  chunks: RetrievedChunk[];
  timings: {
    hyde: number;
    embed: number;
    retrieval: number;
    rerank: number;
    mmr: number;
    total: number;
  };
  hypothetical: string;
};

const VECTOR_CANDIDATES = 30;
const BM25_CANDIDATES = 30;
const RRF_K = 60;
const RERANK_TOP = 15;
const MMR_LAMBDA = 0.7;

/** Parse pgvector text format `'[1,2,3]'` → number[] (format JSON-like). */
function parseVectorText(text: string): number[] {
  return JSON.parse(text) as number[];
}

/** Đọc retrieval mode từ env. Default 'advanced'. */
export function pickRetrievalMode(): RetrievalMode {
  const env = process.env.RETRIEVAL_MODE;
  if (env === 'basic' || env === 'advanced') return env;
  return 'advanced';
}

/**
 * Build system prompt tutor — port nguyên văn chat/system-prompt.ts.
 * 0 chunks → general-knowledge mode; có chunks → context block + citation
 * rules BẮT BUỘC [N] ASCII brackets (UI parser chỉ nhận ASCII, cấm 【】).
 */
export function buildSystemPrompt(chunks: RetrievedChunk[]): string {
  const today = new Date().toISOString().split('T')[0];

  if (chunks.length === 0) {
    // Không có tài liệu nào match → tutor mode general
    return `You are Cogniva, an AI tutor specialized in clear, first-principles teaching.

The user hasn't uploaded relevant documents for this question yet, so answer from your general knowledge — but be honest about that. Recommend they upload sources for grounded answers.

Today's date: ${today}.

Style:
- Use Markdown (headings, lists, **bold**, \`code\`, KaTeX \`$math$\`).
- Be concise but explain *why*, not just *what*.
- Ask one clarifying question if intent is ambiguous.`;
  }

  const contextBlock = chunks
    .map((chunk, i) => {
      const idx = i + 1;
      const pageRef = chunk.page ? ` trang ${chunk.page}` : '';
      return `[${idx}] Trích từ "${chunk.filename}"${pageRef} (similarity ${chunk.score.toFixed(2)}):
${chunk.content}`;
    })
    .join('\n\n---\n\n');

  return `You are Cogniva, an AI tutor specialized in clear, first-principles teaching grounded in the user's own materials.

# Today's date
${today}

# Retrieved context from the user's documents
${contextBlock}

# Citation rules (CRITICAL)
- Every factual claim derived from the context above MUST end with a citation using **ASCII square brackets** like \`[1]\` or \`[2,3]\` referring to the chunk index (1-indexed). Do NOT use CJK brackets 【】 even when writing in Vietnamese — UI parser only recognizes ASCII brackets.
- If the context doesn't contain enough info, SAY SO clearly: "Tôi không thấy thông tin về … trong tài liệu của bạn. Có thể bạn cần upload thêm nguồn về chủ đề này."
- NEVER cite sources outside the retrieved context. NEVER invent page numbers or quotes.

# Style
- Use Markdown freely (headings, lists, **bold**, \`code\`, blockquotes, KaTeX inline \`$x$\` and block \`$$..$$\`).
- Lead with the answer, then explain the *why* and *how*, then suggest a follow-up.
- Adapt depth to the user's apparent level — don't lecture if they ask a quick question.
- If user asks in Vietnamese, answer in Vietnamese; if in English, English.`;
}

@Injectable()
export class RetrievalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly router: RouterService,
  ) {}

  /** Build chat context cho streamText — wrapper retrieve → system prompt. */
  async buildChatContext(opts: BuildContextOptions): Promise<ChatContext> {
    const mode = opts.mode ?? pickRetrievalMode();
    const topK = opts.topK ?? 5;

    if (mode === 'advanced') {
      const start = Date.now();
      const result = await this.advancedRetrieve({
        query: opts.query,
        userId: opts.userId,
        plan: opts.plan,
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
    const queryEmbedding = await this.embedding.embedQuery(opts.query);
    const chunks = await this.retrieveChunks({
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

  /**
   * Chạy full advanced pipeline. Chunks output không kèm embedding (strip
   * để giảm payload). Per-stage timings giữ nguyên cho debug/dashboard.
   */
  private async advancedRetrieve(opts: {
    query: string;
    userId: string;
    plan: Plan;
    workspaceId?: string;
    documentIds?: string[];
    topK?: number;
  }): Promise<AdvancedRetrieveResult> {
    const { query, userId, plan, workspaceId, documentIds, topK = 5 } = opts;

    const t0 = Date.now();

    // Stage 1: HyDE
    const hypothetical = await generateHypotheticalAnswer(this.router, query, { userId, plan });
    const t1 = Date.now();

    // Stage 2: Embed (dùng hypothetical thay vì query gốc — khác biệt then
    // chốt của HyDE so với baseline RAG)
    const queryEmbedding = await this.embedding.embedQuery(hypothetical);
    const t2 = Date.now();

    // Stage 3: Hybrid — chạy song song để tiết kiệm latency.
    // includeEmbedding=true để MMR có sẵn vector tính diversity cuối pipeline
    const [vectorHits, bm25Hits] = await Promise.all([
      this.retrieveChunks({
        queryEmbedding,
        userId,
        workspaceId,
        documentIds,
        topK: VECTOR_CANDIDATES,
        includeEmbedding: true,
      }),
      this.bm25Search({
        query,
        userId,
        workspaceId,
        documentIds,
        topK: BM25_CANDIDATES,
        includeEmbedding: true,
      }),
    ]);
    const t3 = Date.now();

    // Stage 4: RRF merge (synchronous, micro)
    const merged = reciprocalRankFusion([vectorHits, bm25Hits], {
      k: RRF_K,
      topK: VECTOR_CANDIDATES + BM25_CANDIDATES,
    });

    // Stage 5: Cohere rerank → keep top RERANK_TOP cho MMR có chỗ cắt
    const reranked = await rerankChunks({ query, documents: merged, topN: RERANK_TOP });
    const t4 = Date.now();

    // Stage 6: MMR — cần embedding. Lọc chunks có embedding rồi feed.
    let final: RetrievedChunk[];
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

  /**
   * Vector search pgvector: `embedding <=> $1::vector` cosine distance,
   * score = 1 - distance/2 ∈ [0,1]. JOIN document check user_id + READY.
   */
  private async retrieveChunks(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
    const {
      queryEmbedding,
      userId,
      topK = 5,
      workspaceId,
      documentIds,
      includeEmbedding = false,
    } = opts;

    // pgvector format: '[0.1,0.2,...]'
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    const embeddingSelect = includeEmbedding
      ? Prisma.sql`, c.embedding::text AS embedding`
      : Prisma.empty;
    const workspaceFilter = workspaceId
      ? Prisma.sql`AND d.workspace_id = ${workspaceId}`
      : Prisma.empty;
    const documentFilter = this.buildDocumentFilter(documentIds);

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        content: string;
        document_id: string;
        filename: string;
        page: number | null;
        distance: number;
        embedding?: string;
      }>
    >(Prisma.sql`
      SELECT
        c.id,
        c.content,
        c.document_id,
        d.filename,
        (c.metadata->>'page')::int AS page,
        (c.embedding <=> ${vectorLiteral}::vector) AS distance
        ${embeddingSelect}
      FROM chunk c
      INNER JOIN document d ON d.id = c.document_id
      WHERE d.user_id = ${userId}
        AND d.status = 'READY'
        ${workspaceFilter}
        ${documentFilter}
      ORDER BY c.embedding <=> ${vectorLiteral}::vector
      LIMIT ${topK};
    `);

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      documentId: r.document_id,
      filename: r.filename,
      page: r.page,
      // Cosine distance ∈ [0, 2]; convert sang similarity score [0, 1]
      score: Math.max(0, 1 - Number(r.distance) / 2),
      ...(includeEmbedding && r.embedding ? { embedding: parseVectorText(r.embedding) } : {}),
    }));
  }

  /**
   * BM25-like full-text: to_tsvector('english') @@ websearch_to_tsquery +
   * ts_rank_cd flag 32 (norm ∈ [0,1)) — hit GIN index sẵn trong schema.
   * Score KHÔNG trộn trực tiếp với cosine — phải qua RRF.
   */
  private async bm25Search(opts: {
    query: string;
    userId: string;
    topK?: number;
    workspaceId?: string;
    documentIds?: string[];
    includeEmbedding?: boolean;
  }): Promise<RetrievedChunk[]> {
    const {
      query,
      userId,
      topK = 30,
      workspaceId,
      documentIds,
      includeEmbedding = false,
    } = opts;

    const cleaned = query.trim();
    if (!cleaned) return [];

    const embeddingSelect = includeEmbedding
      ? Prisma.sql`, c.embedding::text AS embedding`
      : Prisma.empty;
    const workspaceFilter = workspaceId
      ? Prisma.sql`AND d.workspace_id = ${workspaceId}`
      : Prisma.empty;
    const documentFilter = this.buildDocumentFilter(documentIds);

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        content: string;
        document_id: string;
        filename: string;
        page: number | null;
        rank: number;
        embedding?: string;
      }>
    >(Prisma.sql`
      SELECT
        c.id,
        c.content,
        c.document_id,
        d.filename,
        (c.metadata->>'page')::int AS page,
        ts_rank_cd(
          to_tsvector('english', c.content),
          websearch_to_tsquery('english', ${cleaned}),
          32
        ) AS rank
        ${embeddingSelect}
      FROM chunk c
      INNER JOIN document d ON d.id = c.document_id
      WHERE d.user_id = ${userId}
        AND d.status = 'READY'
        ${workspaceFilter}
        ${documentFilter}
        AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', ${cleaned})
      ORDER BY rank DESC
      LIMIT ${topK};
    `);

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      documentId: r.document_id,
      filename: r.filename,
      page: r.page,
      score: Number(r.rank), // ts_rank_cd với norm 32 ∈ [0, 1)
      ...(includeEmbedding && r.embedding ? { embedding: parseVectorText(r.embedding) } : {}),
    }));
  }

  /**
   * Document-level filter khi user pin tài liệu — Postgres ARRAY literal
   * '{...}'::text[], escape `"` trong UUID (safe-guard, copy nguyên web).
   */
  private buildDocumentFilter(documentIds?: string[]): Prisma.Sql {
    if (!documentIds || documentIds.length === 0) return Prisma.empty;
    const literal = `{${documentIds.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',')}}`;
    return Prisma.sql`AND d.id = ANY(${literal}::text[])`;
  }
}
