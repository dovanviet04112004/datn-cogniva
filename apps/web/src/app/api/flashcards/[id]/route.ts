/**
 * /api/flashcards/[id] — GET / DELETE 1 card.
 *
 * Bảo mật: verify flashcard.userId === session.user.id (chống IDOR).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, flashcard } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onFlashcardChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const [row] = await db
    .select()
    .from(flashcard)
    .where(and(eq(flashcard.id, id), eq(flashcard.userId, session.user.id)))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ flashcard: row });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const result = await db
    .delete(flashcard)
    .where(and(eq(flashcard.id, id), eq(flashcard.userId, session.user.id)))
    .returning({ id: flashcard.id, workspaceId: flashcard.workspaceId });

  if (result.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Xoá card → flashcard stats + dashboard cardsDue (+ workspace stats) đổi.
  await onFlashcardChanged(session.user.id, result[0]?.workspaceId);
  return NextResponse.json({ ok: true });
}
