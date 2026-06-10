/**
 * BM25 — full-text retrieval bằng Postgres tsvector + ts_rank_cd.
 *
 * Vì sao Postgres native?
 *   - Schema đã có sẵn GIN index `to_tsvector('english', content)` trên chunk
 *     (xem packages/db/src/schema.ts) → query nhanh dù chunk có triệu dòng.
 *   - Không cần thêm dependency (Elasticsearch/Tantivy/Meilisearch) cho 1 vai
 *     trò phụ trong hybrid search.
 *   - ts_rank_cd ≈ BM25 — cùng họ algorithm "term frequency với length norm".
 *
 * Lưu ý ngôn ngữ:
 *   - Index dùng config 'english' (stemming+stopwords cho Anglo). Tài liệu
 *     tiếng Việt KHÔNG hưởng stemming nhưng tokenize theo whitespace + lower
 *     vẫn hoạt động cho exact-keyword match.
 *   - Phase 4 cân nhắc multilingual config hoặc unaccent extension cho VN.
 *   - Quan trọng: query phải dùng cùng config 'english' để hit index — đổi
 *     config sang 'simple' sẽ miss GIN và full-scan toàn bảng.
 *
 * Khác biệt với vector search:
 *   - BM25 thắng khi query có proper noun, mã sản phẩm, tên riêng, công thức.
 *   - Vector thắng khi query semantic ("ý chính của chương 3").
 *   - Hybrid (RRF) cộng dồn 2 lợi thế.
 */
import { db, sql } from '@cogniva/db';

import { parseVectorText, type RetrievedChunk } from './index';

export type BM25Options = {
  /** Query thô — sẽ qua websearch_to_tsquery để parse OR/AND/quote tự nhiên. */
  query: string;
  /** Scope theo user — bắt buộc tránh leak chunks. */
  userId: string;
  /** Số chunk top trả về (default 30 cho hybrid candidate set). */
  topK?: number;
  /** (Optional) lọc 1 workspace cụ thể. */
  workspaceId?: string;
  /**
   * (Optional) lọc tập document cụ thể — match với retrieveChunks. Khi user
   * pin docs trong panel, BM25 cũng phải giới hạn cùng subset.
   */
  documentIds?: string[];
  /** Trả về thêm embedding 1024-dim cho MMR — default false. */
  includeEmbedding?: boolean;
};

/**
 * Tìm top-K chunks match keyword theo BM25-like ranking.
 *
 * Score normalize ∈ [0,1) qua flag 32: rank/(rank+1) — giá trị càng cao
 * càng match. KHÁC với cosine similarity (cũng [0,1]) — không trộn trực tiếp,
 * phải qua RRF.
 */
export async function bm25Search(opts: BM25Options): Promise<RetrievedChunk[]> {
  const {
    query,
    userId,
    topK = 30,
    workspaceId,
    documentIds,
    includeEmbedding = false,
  } = opts;

  // Trim + bỏ ký tự đặc biệt khiến websearch_to_tsquery throw
  // (websearch_to_tsquery rất permissive, nhưng query rỗng vẫn match nothing)
  const cleaned = query.trim();
  if (!cleaned) return [];

  // Tách fragment điều kiện ra biến — tránh type collision SQL<unknown> giữa
  // 2 version drizzle-orm trong workspace (xem note ở retrieval/index.ts)
  const embeddingSelect = includeEmbedding
    ? sql`, c.embedding::text AS embedding`
    : sql``;
  const workspaceFilter = workspaceId
    ? sql`AND d.workspace_id = ${workspaceId}`
    : sql``;
  const documentFilter =
    documentIds && documentIds.length > 0
      ? sql`AND d.id = ANY(${`{${documentIds
          .map((id) => `"${id.replace(/"/g, '\\"')}"`)
          .join(',')}}`}::text[])`
      : sql``;

  const rows = await db.execute<{
    id: string;
    content: string;
    document_id: string;
    filename: string;
    page: number | null;
    rank: number;
    embedding?: string;
  }>(sql`
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
