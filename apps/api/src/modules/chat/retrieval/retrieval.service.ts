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
  id: string;
  content: string;
  documentId: string;
  filename: string;
  page: number | null;
  score: number;
  embedding?: number[];
};

export type RetrievalMode = 'basic' | 'advanced';

export type ChatContext = {
  chunks: RetrievedChunk[];
  systemPrompt: string;
  retrievalMs: number;
  mode: RetrievalMode;
  hypothetical?: string;
  timings?: Record<string, number>;
};

export type BuildContextOptions = {
  query: string;
  userId: string;
  plan: Plan;
  workspaceId?: string;
  documentIds?: string[];
  topK?: number;
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

function parseVectorText(text: string): number[] {
  return JSON.parse(text) as number[];
}

export function pickRetrievalMode(): RetrievalMode {
  const env = process.env.RETRIEVAL_MODE;
  if (env === 'basic' || env === 'advanced') return env;
  return 'advanced';
}

export function buildSystemPrompt(chunks: RetrievedChunk[]): string {
  const today = new Date().toISOString().split('T')[0];

  if (chunks.length === 0) {
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

    const hypothetical = await generateHypotheticalAnswer(this.router, query, { userId, plan });
    const t1 = Date.now();

    const queryEmbedding = await this.embedding.embedQuery(hypothetical);
    const t2 = Date.now();

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

    const merged = reciprocalRankFusion([vectorHits, bm25Hits], {
      k: RRF_K,
      topK: VECTOR_CANDIDATES + BM25_CANDIDATES,
    });

    const reranked = await rerankChunks({ query, documents: merged, topN: RERANK_TOP });
    const t4 = Date.now();

    let final: RetrievedChunk[];
    const withEmbedding: ChunkWithEmbedding[] = reranked.filter((c): c is ChunkWithEmbedding =>
      Array.isArray(c.embedding),
    );
    if (withEmbedding.length >= topK) {
      const diverse = mmrFilter(queryEmbedding, withEmbedding, {
        lambda: MMR_LAMBDA,
        topN: topK,
      });
      final = diverse.map(({ embedding: _e, ...rest }) => rest);
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

  private async retrieveChunks(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
    const {
      queryEmbedding,
      userId,
      topK = 5,
      workspaceId,
      documentIds,
      includeEmbedding = false,
    } = opts;

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
      score: Math.max(0, 1 - Number(r.distance) / 2),
      ...(includeEmbedding && r.embedding ? { embedding: parseVectorText(r.embedding) } : {}),
    }));
  }

  private async bm25Search(opts: {
    query: string;
    userId: string;
    topK?: number;
    workspaceId?: string;
    documentIds?: string[];
    includeEmbedding?: boolean;
  }): Promise<RetrievedChunk[]> {
    const { query, userId, topK = 30, workspaceId, documentIds, includeEmbedding = false } = opts;

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
      score: Number(r.rank),
      ...(includeEmbedding && r.embedding ? { embedding: parseVectorText(r.embedding) } : {}),
    }));
  }

  private buildDocumentFilter(documentIds?: string[]): Prisma.Sql {
    if (!documentIds || documentIds.length === 0) return Prisma.empty;
    const literal = `{${documentIds.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',')}}`;
    return Prisma.sql`AND d.id = ANY(${literal}::text[])`;
  }
}
