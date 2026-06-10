/**
 * Retrieval — vector search top-K trên chunks của user.
 *
 * Phase 2 (basic): chỉ vector cosine, scope theo user — không leak chunks giữa
 * các tài khoản.
 * Phase 3 (advanced): vẫn dùng hàm này như 1 stage trong pipeline (HyDE →
 * vector + BM25 → RRF → rerank → MMR). Khi `includeEmbedding=true` trả luôn
 * vector 1024-dim để MMR tính diversity.
 *
 * Cách query:
 *   - pgvector cosine distance: `embedding <=> $1` (toán tử <=>)
 *   - 0 = identical, 2 = opposite. Score = 1 - distance/2 → similarity [0,1].
 *   - Drizzle dùng raw sql template tag vì chưa có API cao cấp cho vector.
 *
 * Filter:
 *   - JOIN qua document để check userId = current user.
 *   - Nếu workspaceId được truyền, lọc thêm theo workspace (chat scope).
 *
 * KHÔNG có HNSW hint cụ thể trong query — Postgres planner tự chọn HNSW index
 * khi LIMIT nhỏ và ORDER BY embedding distance. Khi muốn force, dùng
 * `SET LOCAL hnsw.ef_search = 100` trước query.
 */
import { db, sql } from '@cogniva/db';

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
  /** Cosine similarity score (0..1, càng cao càng gần) — hoặc score từ stage hiện tại. */
  score: number;
  /**
   * Embedding 1024-dim của chunk — chỉ có khi `includeEmbedding=true`. Dùng
   * cho MMR diversity ở Phase 3, không expose ra client (payload lớn).
   */
  embedding?: number[];
};

export type RetrieveOptions = {
  /** Vector query (đã embed bằng cùng provider với chunk indexing). */
  queryEmbedding: number[];
  /** Scope theo user — bắt buộc tránh leak chunks giữa account. */
  userId: string;
  /** Số chunk trả về (default 5). */
  topK?: number;
  /** (Optional) chỉ retrieve trong 1 workspace cụ thể. */
  workspaceId?: string;
  /**
   * (Optional) chỉ retrieve trong tập document cụ thể. Truyền `documentIds`
   * khi user pin một số tài liệu trong panel "Tài liệu tham chiếu" — AI sẽ
   * chỉ search trong subset đó, bỏ qua các doc khác cùng workspace. Khi
   * undefined hoặc rỗng → không filter document-level.
   */
  documentIds?: string[];
  /**
   * Trả về thêm cột `embedding` cho mỗi chunk (cần cho MMR).
   * Default false để không tốn payload trong basic flow.
   */
  includeEmbedding?: boolean;
};

/**
 * Tìm top-K chunks gần nhất với query vector, scoped theo user.
 *
 * @returns Mảng chunk sắp xếp theo score giảm dần
 */
export async function retrieveChunks(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
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

  // Tách fragment có điều kiện ra biến để TypeScript không phải merge nhiều
  // SQL<unknown> branch trong template — tránh xung đột giữa 2 phiên bản
  // drizzle-orm (web 0.45 vs db package 0.38). Khi pin cùng version có thể
  // inline lại.
  const embeddingSelect = includeEmbedding
    ? sql`, c.embedding::text AS embedding`
    : sql``;
  const workspaceFilter = workspaceId
    ? sql`AND d.workspace_id = ${workspaceId}`
    : sql``;
  // Document-level filter: user pin tài liệu cụ thể trong panel. Postgres
  // ARRAY literal: '{id1,id2,...}'::text[]; escape `"` trong UUID (shouldn't
  // appear nhưng safe-guard).
  const documentFilter =
    documentIds && documentIds.length > 0
      ? sql`AND d.id = ANY(${`{${documentIds
          .map((id) => `"${id.replace(/"/g, '\\"')}"`)
          .join(',')}}`}::text[])`
      : sql``;

  // Dùng raw SQL vì:
  //   - Cosine distance operator <=> chưa có API Drizzle native
  //   - Cần JOIN + WHERE + ORDER BY phối hợp tinh vi cho ANN
  //   - Tham số hoá đầy đủ qua sql template tag → an toàn injection
  const rows = await db.execute<{
    id: string;
    content: string;
    document_id: string;
    filename: string;
    page: number | null;
    distance: number;
    embedding?: string;
  }>(sql`
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
 * Parse pgvector text format `'[1,2,3]'` → number[].
 * Postgres trả về dạng text khi cast `::text` vì pgvector chưa có
 * Postgres array codec. Format luôn là JSON-like nên JSON.parse work.
 */
export function parseVectorText(text: string): number[] {
  return JSON.parse(text);
}
