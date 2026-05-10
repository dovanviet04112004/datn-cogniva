/**
 * Concept dedup — khi LLM extract "Định lý Pythagoras" trong 5 chunks
 * khác nhau, ta KHÔNG muốn tạo 5 concept rows. Dùng vector similarity
 * trên concept name để gộp về 1 concept duy nhất.
 *
 * Cách hoạt động:
 *   1. Embed concept name (ngắn ~3-10 từ) bằng Voyage query mode.
 *   2. Search HNSW concept_embedding_idx tìm similarity > THRESHOLD.
 *   3. Nếu match → reuse concept.id có sẵn.
 *   4. Nếu không → INSERT new concept với embedding.
 *
 * Threshold 0.85:
 *   - Plan §6.1.9 nêu giá trị này, validated empirically:
 *     * 0.95+: false negative cao (Pythagoras vs Định lý Pythagoras tách 2)
 *     * 0.75-: false positive cao (gộp khái niệm khác nhau).
 *   - Tinh chỉnh trên dataset thực ở Phase 6 nếu cần.
 *
 * Race condition trong concurrent extraction:
 *   - 2 chunks cùng có "Pythagoras" → 2 calls findOrCreate đồng thời, có thể
 *     cả 2 đều miss và INSERT 2 row. Sẽ chấp nhận (Phase 4 v1) — Phase 5
 *     thêm advisory lock hoặc unique constraint trên (name, domain) lower.
 */
import { eq } from 'drizzle-orm';

import { db, sql, concept } from '@cogniva/db';

import { embedQuery } from '@/lib/ingest/embed-query';
import { parseVectorText } from '@/lib/retrieval';

import type { ExtractedConcept } from './extract';

/** Ngưỡng cosine similarity coi 2 concept là "trùng". */
const DEDUP_THRESHOLD = 0.85;

export type ConceptRow = {
  id: string;
  name: string;
  description: string | null;
  domain: string;
  /** Có thể null khi tạo từ schema cũ. */
  embedding?: number[];
};

/**
 * Tìm concept có sẵn match name (similarity > threshold). Nếu không có,
 * tạo mới và return ID.
 *
 * @returns ID của concept (mới hoặc cũ)
 */
export async function findOrCreateConcept(c: ExtractedConcept): Promise<string> {
  // Embed concept name — input chỉ vài chục token, nhanh
  const embedding = await embedQuery(c.name);
  const vectorLiteral = `[${embedding.join(',')}]`;

  // Search HNSW: lấy concept nearest, nếu similarity > threshold thì reuse
  const matches = await db.execute<{
    id: string;
    name: string;
    distance: number;
  }>(sql`
    SELECT
      id,
      name,
      (embedding <=> ${vectorLiteral}::vector) AS distance
    FROM concept
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT 1;
  `);

  const candidate = matches[0];
  if (candidate) {
    // Cosine distance ∈ [0, 2]; similarity = 1 - distance/2
    const similarity = 1 - Number(candidate.distance) / 2;
    if (similarity >= DEDUP_THRESHOLD) {
      return candidate.id;
    }
  }

  // Không match → INSERT new concept
  const [inserted] = await db
    .insert(concept)
    .values({
      name: c.name,
      description: c.description,
      domain: c.domain,
      embedding,
    })
    .returning({ id: concept.id });

  if (!inserted) throw new Error('[dedup] INSERT concept thất bại');
  return inserted.id;
}

/**
 * Lấy tất cả concepts trong DB (cho prerequisite mining + graph viz).
 * Có thể thêm filter user/domain ở Phase sau khi concepts > 1k.
 */
export async function listAllConcepts(): Promise<ConceptRow[]> {
  const rows = await db.select().from(concept);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    domain: r.domain,
    // Drizzle trả vector như number[] qua customType fromDriver
    embedding: Array.isArray(r.embedding) ? r.embedding : undefined,
  }));
}

/** Concept của 1 user (qua chunks → documents → user). Giúp graph scope theo user. */
export async function listConceptsForUser(userId: string): Promise<ConceptRow[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    description: string | null;
    domain: string;
  }>(sql`
    SELECT DISTINCT c.id, c.name, c.description, c.domain
    FROM concept c
    INNER JOIN chunk_concept cc ON cc.concept_id = c.id
    INNER JOIN chunk ch ON ch.id = cc.chunk_id
    INNER JOIN document d ON d.id = ch.document_id
    WHERE d.user_id = ${userId};
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    domain: r.domain,
  }));
}
