/**
 * /api/library/annotations/[id] (Bonus #8 Phase 3).
 *
 *   DELETE /api/library/annotations/[id]      — author xoá note
 *   POST   /api/library/annotations/[id]/vote — toggle helpful vote
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import {
  db,
  libraryDocAnnotation,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const result = await db
    .delete(libraryDocAnnotation)
    .where(
      and(
        eq(libraryDocAnnotation.id, id),
        eq(libraryDocAnnotation.authorId, session.user.id),
      ),
    )
    .returning({ id: libraryDocAnnotation.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'Not found or forbidden' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

