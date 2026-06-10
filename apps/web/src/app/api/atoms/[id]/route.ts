/**
 * GET /api/atoms/[id] — trả AtomView (concept + mastery + counts).
 *
 * Phase A9 (atom-centric). Dùng cho UI atom detail page (Phase C4) +
 * workspace "Today" card preview. Atom là global (không scope user) nên
 * không kiểm tra ownership — chỉ require auth để biết userId mà query
 * mastery.
 *
 * Spec: docs/plans/atom-centric.md §4.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { getAtomView } from '@/lib/atoms/get-atom';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const userId = session.user.id;

  // Cache-aside per-(user, atom): bấm đi bấm lại 1 atom (hoặc nhiều user xem
  // chung) → 1 lần query Neon, các lần sau cache hit (tránh 5 query/round-trip
  // Singapore mỗi click). TTL 60s + bust qua onMasteryChanged(…, conceptId) khi
  // mastery đổi; count đổi (gen) tự mới qua TTL. getAtomView trả Date →
  // NextResponse.json serialize ISO; cache hit là string sẵn → đồng nhất.
  const atom = await cached(ck.atomView(userId, id), 60, () =>
    getAtomView(id, userId),
  );
  if (!atom) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ atom });
}
