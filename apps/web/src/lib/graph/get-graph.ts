/**
 * get-graph.ts — Knowledge graph của 1 user (server-only), CACHE-ASIDE Tier 1.
 *
 * Vì sao tách lib-fn riêng (không cache inline trong route)?
 *   - Route `GET /api/graph` trước đây build graph inline từ 3 nguồn đọc thuần
 *     (concepts theo user/workspace + prerequisite edges + mastery scores). Gom
 *     về 1 hàm cache-được giúp: 1 chỗ định nghĩa key, 1 chỗ route replica, dễ
 *     invalidate. Module `lib/concepts/*` là module DÙNG CHUNG cho cả mining
 *     (write LLM) lẫn viz — KHÔNG đổi `db`→`dbReplica` trong đó (rủi ro
 *     read-your-own-write khi mine rồi đọc lại cùng request) → ở đây tự đọc thuần
 *     qua replica thay vì gọi lại các hàm `db` của module chung.
 *
 * Cache-aside Redis (TTL 3600s = 1h): graph đổi khi concept/edge của user thay
 * đổi — chỉ xảy ra khi upload/xoá document (extract concept) hoặc mine prereq.
 * Invalidate đã CÓ SẴN qua `onDocumentChanged` (xoá ck.graph(userId,'all') +
 * ck.graph(userId, ws)) — không cần thêm choke point mới. TTL 1h là lưới an toàn
 * cuối nếu sót invalidation.
 *
 * dbReplica: 3 read thuần (SELECT DISTINCT concepts, edges, mastery), KHÔNG
 * read-your-own-write tức thì trong cùng request (viz tách hẳn write) → route
 * replica giảm tải primary (fallback primary khi chưa cấu hình replica).
 *
 * Date-serialization: output chỉ chứa string/number (mastery.score là number,
 * relationType/name/description là string) — KHÔNG có field Date nào, consumer
 * chỉ `NextResponse.json`. Vì vậy KHÔNG cần re-hydrate Date sau cache.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { dbReplica, mastery as masteryTable, sql } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

/** Node React Flow — { id, type, data, position } (position client tự layout). */
export type GraphNode = {
  id: string;
  type: 'concept';
  data: {
    name: string;
    description: string | null;
    domain: string;
    /** Mastery BKT score (0..1) — undefined nếu user chưa attempt concept đó. */
    mastery?: number;
  };
  position: { x: number; y: number };
};

/** Edge React Flow — quan hệ prerequisite giữa 2 concept. */
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  data: { strength: number; relationType: string };
};

export type GraphPayload = { nodes: GraphNode[]; edges: GraphEdge[] };

/** Row concept tối thiểu cho viz (đọc qua replica). */
type ConceptRow = { id: string; name: string; description: string | null; domain: string };

/**
 * Graph (nodes + edges) của user, có thể scope theo 1 workspace.
 *
 * @param userId      Chủ sở hữu concepts (scope qua document.user_id).
 * @param workspaceId Lọc theo workspace (V5 MindMap recipe); null/undefined = toàn bộ.
 */
export async function getGraphForUser(
  userId: string,
  workspaceId?: string | null,
): Promise<GraphPayload> {
  // ws='all' khi không lọc workspace — KHỚP với key invalidator xoá (ck.graph(u,'all')).
  return cached(ck.graph(userId, workspaceId ?? 'all'), 3600, () =>
    fetchGraph(userId, workspaceId ?? null),
  );
}

/** Truy vấn thật dựng graph — chỉ chạy khi cache MISS. */
async function fetchGraph(userId: string, workspaceId: string | null): Promise<GraphPayload> {
  // ── 1. Concepts của user (qua chunk → document), lọc workspace nếu có ──────
  // Scope theo user qua pivot chunk_concept → chunk → document (concept không
  // có cột user_id — entity dùng chung). dbReplica: read thuần list.
  const concepts = await dbReplica.execute<ConceptRow>(
    workspaceId
      ? sql`
          SELECT DISTINCT c.id, c.name, c.description, c.domain
          FROM concept c
          INNER JOIN chunk_concept cc ON cc.concept_id = c.id
          INNER JOIN chunk ch ON ch.id = cc.chunk_id
          INNER JOIN document d ON d.id = ch.document_id
          WHERE d.user_id = ${userId}
            AND d.workspace_id = ${workspaceId};
        `
      : sql`
          SELECT DISTINCT c.id, c.name, c.description, c.domain
          FROM concept c
          INNER JOIN chunk_concept cc ON cc.concept_id = c.id
          INNER JOIN chunk ch ON ch.id = cc.chunk_id
          INNER JOIN document d ON d.id = ch.document_id
          WHERE d.user_id = ${userId};
        `,
  );

  const conceptIds = concepts.map((c) => c.id);

  // ── 2. Prerequisite edges giữa các concept đang hiển thị ──────────────────
  // Chỉ lấy cạnh mà CẢ from & to đều nằm trong tập concept của user (tránh kéo
  // cạnh trỏ ra concept ngoài scope). ANY(text[]) literal khớp query gốc.
  const idsArrayLiteral = `{${conceptIds.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',')}}`;
  const relations = conceptIds.length
    ? await dbReplica.execute<{
        from_id: string;
        to_id: string;
        relation_type: string;
        strength: number;
      }>(sql`
        SELECT from_id, to_id, relation_type, strength
        FROM concept_relation
        WHERE from_id = ANY(${idsArrayLiteral}::text[])
          AND to_id = ANY(${idsArrayLiteral}::text[]);
      `)
    : [];

  // ── 3. Mastery scores → tô màu node theo BKT (đỏ/vàng/xanh) ────────────────
  const masteryRows = conceptIds.length
    ? await dbReplica
        .select({ conceptId: masteryTable.conceptId, score: masteryTable.score })
        .from(masteryTable)
        .where(
          and(eq(masteryTable.userId, userId), inArray(masteryTable.conceptId, conceptIds)),
        )
    : [];
  const masteryMap = new Map(masteryRows.map((m) => [m.conceptId, m.score]));

  // ── 4. Format chuẩn React Flow — client (Dagre/ELK) tự layout position ─────
  const nodes: GraphNode[] = concepts.map((c) => ({
    id: c.id,
    type: 'concept',
    data: {
      name: c.name,
      description: c.description,
      domain: c.domain,
      mastery: masteryMap.get(c.id), // undefined nếu chưa attempt
    },
    position: { x: 0, y: 0 }, // 0,0 — client layout sẽ override
  }));

  const edges: GraphEdge[] = relations.map((r, i) => ({
    id: `${r.from_id}->${r.to_id}-${i}`,
    source: r.from_id,
    target: r.to_id,
    label: r.relation_type,
    data: { strength: Number(r.strength), relationType: r.relation_type },
  }));

  return { nodes, edges };
}
