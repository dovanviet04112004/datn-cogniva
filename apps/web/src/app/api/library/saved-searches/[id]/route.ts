/**
 * DELETE /api/library/saved-searches/[id] — user xoá bookmark.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, librarySavedSearch } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const result = await db
    .delete(librarySavedSearch)
    .where(
      and(
        eq(librarySavedSearch.id, id),
        eq(librarySavedSearch.userId, session.user.id),
      ),
    )
    .returning({ id: librarySavedSearch.id });
  if (result.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
