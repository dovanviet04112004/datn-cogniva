/**
 * Retrieval — vector search top-K trên chunks của user.
 *
 * Phase 2 v1 (MVP) chỉ dùng vector cosine similarity, scope theo user
 * (không leak chunks giữa các tài khoản). Phase 3 sẽ nâng lên hybrid
 * (BM25 + vector + reranking + MMR diversity).
 *
 * Cách query:
 *   - pgvector cosine distance: `embedding <=> $1` (toán tử <=>)
 *   - 0 = identical, 2 = opposite. Score = 1 - distance để giống "% match".
 *   - Drizzle dùng raw sql template tag vì chưa có API cao cấp cho vector.
 *
 * Filter:
 *   - JOIN qua document để check userId = current user.
 *   - Nếu workspaceId được truyền, lọc thêm theo workspace (chat scope).
 *
 * KHÔNG có HNSW hint cụ thể trong query — Postgres planner tự chọn
 * HNSW index khi LIMIT nhỏ và ORDER BY embedding distance. Khi muốn
 * force, dùng `SET LOCAL hnsw.ef_search = 100` trước query.
 */
import { sql } from 'drizzle-orm';

import { db } from '@cogniva/db';

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
  /** Cosine similarity score (0..1, càng cao càng gần). */
  score: number;
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
};

/**
 * Tìm top-K chunks gần nhất với query vector, scoped theo user.
 *
 * @returns Mảng chunk sắp xếp theo score giảm dần
 */
export async function retrieveChunks(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const { queryEmbedding, userId, topK = 5, workspaceId } = opts;

  // pgvector format: '[0.1,0.2,...]'
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

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
  }>(sql`
    SELECT
      c.id,
      c.content,
      c.document_id,
      d.filename,
      (c.metadata->>'page')::int AS page,
      (c.embedding <=> ${vectorLiteral}::vector) AS distance
    FROM chunk c
    INNER JOIN document d ON d.id = c.document_id
    WHERE d.user_id = ${userId}
      AND d.status = 'READY'
      ${workspaceId ? sql`AND d.workspace_id = ${workspaceId}` : sql``}
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
  }));
}
