/**
 * GET /api/study-plan/today — proposal hôm nay cho user.
 *
 * Phase B (atom-centric). Idempotent: lần đầu gọi trong ngày → materialize
 * proposal (LLM-free, chỉ DB query); lần sau cùng ngày → return rows cũ.
 *
 * Spec: docs/plans/atom-centric.md §6 Phase B.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { materializeProposalForToday } from '@/lib/study-plan/materialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const items = await materializeProposalForToday(session.user.id);
  return NextResponse.json({ items });
}
