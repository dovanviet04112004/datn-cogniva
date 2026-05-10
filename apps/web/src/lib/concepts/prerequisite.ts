/**
 * Prerequisite mining — LLM scan tập concepts của user → tìm cặp (A → B)
 * nghĩa "muốn hiểu B thì cần biết A trước".
 *
 * Vì sao tách bước riêng (không gộp vào extract)?
 *   - Extract scope là 1 chunk: không thấy được mối quan hệ giữa các
 *     concept ở chunks khác nhau.
 *   - Prerequisite cần xem ÍT NHẤT 5-20 concepts cùng lúc → batch view.
 *
 * Cách hoạt động:
 *   1. Lấy list concepts của user (qua dedup.listConceptsForUser).
 *   2. Group theo domain (math/cs/biology/…) — prereq giữa các domain hiếm.
 *   3. Mỗi nhóm domain ≤ 20 concept → 1 LLM call sinh edges.
 *   4. INSERT vào concept_relation (relationType='prerequisite', strength).
 *
 * Trade-off scope:
 *   - Phase 4 v1: chỉ relationType='prerequisite'. Phase 5+ thêm 'related',
 *     'specializes' (không quan trọng cho mastery tracking).
 *   - Group nhỏ ≤ 20 concept giúp LLM không bỏ sót cặp; lớn hơn dễ miss.
 */
import { generateText } from 'ai';
import { sql } from '@cogniva/db';

import { db, conceptRelation } from '@cogniva/db';

import { getChatModel } from '@/lib/ai/models';

import type { ConceptRow } from './dedup';

const PREREQ_INSTRUCTION = `Bạn là chuyên gia thiết kế đường học. Cho danh sách KHÁI NIỆM dưới đây (cùng domain), liệt kê các cặp prerequisite — cặp (from, to) nghĩa "muốn hiểu \`to\` thì cần biết \`from\` trước".

QUY TẮC:
- Chỉ list cặp THỰC SỰ là prerequisite kiến thức (không phải "related" chung chung).
- Mỗi cặp dùng id từ danh sách (KHÔNG dùng tên).
- Bỏ qua cặp ngược (B prereq A khi A đã prereq B).
- Strength ∈ [0,1]: 1.0 = bắt buộc tuyệt đối, 0.5 = nên biết, 0.3 = giúp hiểu sâu hơn.
- Nếu không có cặp prerequisite rõ ràng → trả mảng RỖNG.

ĐỊNH DẠNG OUTPUT — JSON THUẦN:
{"edges": [{"from": "<id>", "to": "<id>", "strength": 0.8}]}

DANH SÁCH KHÁI NIỆM (id | name | description):
{{LIST}}`;

const MAX_GROUP_SIZE = 20;

function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in LLM output');
  return JSON.parse(match[0]);
}

type Edge = { from: string; to: string; strength: number };

/** Mine prerequisite cho 1 nhóm concepts (≤ MAX_GROUP_SIZE). */
async function mineGroup(concepts: ConceptRow[]): Promise<Edge[]> {
  if (concepts.length < 2) return [];

  const list = concepts
    .map((c) => `${c.id} | ${c.name} | ${c.description ?? '(no description)'}`)
    .join('\n');

  try {
    const { text } = await generateText({
      model: getChatModel(),
      prompt: PREREQ_INSTRUCTION.replace('{{LIST}}', list),
      temperature: 0.2,
      maxTokens: 1000,
    });
    const obj = extractJson(text) as { edges?: unknown };
    if (!Array.isArray(obj.edges)) return [];

    const validIds = new Set(concepts.map((c) => c.id));
    return obj.edges
      .filter((e): e is Edge => {
        const edge = e as Edge;
        return (
          typeof edge?.from === 'string' &&
          typeof edge?.to === 'string' &&
          edge.from !== edge.to &&
          validIds.has(edge.from) &&
          validIds.has(edge.to)
        );
      })
      .map((e) => ({
        from: e.from,
        to: e.to,
        strength: Math.max(0, Math.min(1, Number(e.strength) || 0.5)),
      }));
  } catch (err) {
    console.warn('[prerequisite] mine group failed:', (err as Error).message);
    return [];
  }
}

/**
 * Mine prerequisite cho toàn list concepts. Group theo domain để giảm scope
 * mỗi LLM call + tránh cross-domain false positive.
 */
export async function minePrerequisites(concepts: ConceptRow[]): Promise<number> {
  // Group theo domain
  const byDomain = new Map<string, ConceptRow[]>();
  for (const c of concepts) {
    const arr = byDomain.get(c.domain) ?? [];
    arr.push(c);
    byDomain.set(c.domain, arr);
  }

  const allEdges: Edge[] = [];
  for (const [domain, group] of byDomain) {
    // Nếu group > MAX_GROUP_SIZE, chia nhỏ — không tối ưu vì miss cross-batch
    // edges, nhưng đủ tốt cho Phase 4 v1. Cải tiến Phase 5: hierarchical batching.
    for (let i = 0; i < group.length; i += MAX_GROUP_SIZE) {
      const slice = group.slice(i, i + MAX_GROUP_SIZE);
      const edges = await mineGroup(slice);
      console.log(`  [${domain}] batch ${i}-${i + slice.length}: ${edges.length} edges`);
      allEdges.push(...edges);
    }
  }

  // INSERT edges (idempotent qua ON CONFLICT — schema có uniqueIndex
  // concept_relation_uniq trên (fromId, toId, relationType))
  let inserted = 0;
  for (const edge of allEdges) {
    try {
      await db
        .insert(conceptRelation)
        .values({
          fromId: edge.from,
          toId: edge.to,
          relationType: 'prerequisite',
          strength: edge.strength,
        })
        .onConflictDoNothing();
      inserted++;
    } catch (err) {
      console.warn('[prerequisite] insert edge failed:', (err as Error).message);
    }
  }

  return inserted;
}

/** Lấy tất cả concept_relation cho graph viz. */
export async function listConceptRelations(conceptIds: string[]): Promise<
  { fromId: string; toId: string; relationType: string; strength: number }[]
> {
  if (conceptIds.length === 0) return [];

  const idsArrayLiteral = `{${conceptIds.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',')}}`;

  const rows = await db.execute<{
    from_id: string;
    to_id: string;
    relation_type: string;
    strength: number;
  }>(sql`
    SELECT from_id, to_id, relation_type, strength
    FROM concept_relation
    WHERE from_id = ANY(${idsArrayLiteral}::text[])
      AND to_id = ANY(${idsArrayLiteral}::text[]);
  `);

  return rows.map((r) => ({
    fromId: r.from_id,
    toId: r.to_id,
    relationType: r.relation_type,
    strength: Number(r.strength),
  }));
}
