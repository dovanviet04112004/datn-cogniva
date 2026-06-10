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

import { auth } from '@/lib/auth';
import { getGraphForUser } from '@/lib/graph/get-graph';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // V5 (atom-centric): scope theo workspace nếu được pass — cho MindMap
  // recipe trong workspace notebook chỉ render atoms của workspace đó.
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspaceId');

  // Read dựng graph (concepts + edges + mastery) đã gom về lib-fn cache-aside
  // (Redis TTL 1h, dbReplica). Output chuẩn React Flow — frontend dùng trực tiếp.
  const payload = await getGraphForUser(session.user.id, workspaceId);

  return NextResponse.json(payload);
}
