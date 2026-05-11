/**
 * GET /api/graph — knowledge graph của user (concepts + prerequisite edges).
 *
 * Output (Phase 4 v1):
 *   {
 *     nodes: [{ id, name, description, domain, mastery? }],
 *     edges: [{ id, source, target, relationType, strength }]
 *   }
 *
 * Format chuẩn React Flow — frontend dùng trực tiếp không cần transform.
 *
 * Bảo mật: scope theo session.user.id qua chunk_concept → chunk → document
 * (chỉ concepts được link tới chunks của user). Concept là entity dùng chung
 * (không có user_id cột) nhưng pivot scope theo user.
 *
 * Phase 6: query bảng mastery để tô màu node theo BKT score (đỏ < 0.4,
 * vàng 0.4-0.7, xanh ≥ 0.7). Concept chưa attempt → mastery = undefined,
 * ConceptNode render màu xám.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';

import { db, mastery as masteryTable } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { listConceptRelations, listConceptsForUser } from '@/lib/concepts';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const concepts = await listConceptsForUser(session.user.id);
  const conceptIds = concepts.map((c) => c.id);
  const relations = await listConceptRelations(conceptIds);

  // Lấy mastery scores cho concepts của user — gắn vào data.mastery
  const masteryRows = conceptIds.length
    ? await db
        .select({
          conceptId: masteryTable.conceptId,
          score: masteryTable.score,
        })
        .from(masteryTable)
        .where(
          and(
            eq(masteryTable.userId, session.user.id),
            inArray(masteryTable.conceptId, conceptIds),
          ),
        )
    : [];
  const masteryMap = new Map(masteryRows.map((m) => [m.conceptId, m.score]));

  // Format nodes — React Flow yêu cầu { id, position, data }
  // Position auto-layout phía client (Dagre / ELK) → server không tính.
  const nodes = concepts.map((c) => ({
    id: c.id,
    type: 'concept', // ConceptNode component custom
    data: {
      name: c.name,
      description: c.description,
      domain: c.domain,
      mastery: masteryMap.get(c.id), // undefined nếu chưa attempt
    },
    // Position 0,0 — client layout sẽ override
    position: { x: 0, y: 0 },
  }));

  const edges = relations.map((r, i) => ({
    id: `${r.fromId}->${r.toId}-${i}`,
    source: r.fromId,
    target: r.toId,
    label: r.relationType,
    data: { strength: r.strength, relationType: r.relationType },
    // Style mặc định — frontend custom thêm theo strength
  }));

  return NextResponse.json({ nodes, edges });
}
