/**
 * GET /api/workspaces/[id]/today — proposal hôm nay scope theo workspace.
 *
 * Khác /api/study-plan/today (global):
 *   - Filter atom đến từ document của workspace này
 *   - KHÔNG materialize (không INSERT studyPlanItem) — chỉ preview cho
 *     TodayCard ở workspace detail. User vẫn vào /study-plan để accept.
 *
 * Phase B (atom-centric). Spec: docs/plans/atom-centric.md §6 Phase B B5.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, workspace } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { proposeForToday } from '@/lib/study-plan/propose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Verify workspace thuộc user (chống IDOR)
  const [ws] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.id, id), eq(workspace.userId, session.user.id)))
    .limit(1);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const proposal = await proposeForToday(session.user.id, id);
  return NextResponse.json({ proposal });
}
