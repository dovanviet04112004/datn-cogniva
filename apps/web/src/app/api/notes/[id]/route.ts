/**
 * /api/notes/[id] — get (GET), update (PATCH), delete (DELETE).
 *
 * PATCH body: { title?, content? } — partial update, auto-bump updated_at.
 *
 * Scope: chỉ owner (note.user_id) thao tác được.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, note } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onWorkspaceContentChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

async function getOwnedNote(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(note)
    .where(and(eq(note.id, id), eq(note.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = await getOwnedNote(id, session.user.id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ note: row });
}

const UPDATE_SCHEMA = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = UPDATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await getOwnedNote(id, session.user.id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [updated] = await db
    .update(note)
    .set({
      title: parsed.data.title ?? existing.title,
      content: parsed.data.content ?? existing.content,
      updatedAt: new Date(),
    })
    .where(eq(note.id, id))
    .returning();
  return NextResponse.json({ note: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Lấy kèm workspaceId từ .returning() để biết workspace nào cần bust badge stats.
  const result = await db
    .delete(note)
    .where(and(eq(note.id, id), eq(note.userId, session.user.id)))
    .returning({ id: note.id, workspaceId: note.workspaceId });
  if (result.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Note bị xoá đổi count notes của workspace → bust workspaceStats/atoms.
  // Chỉ khi note thuộc workspace cụ thể (bỏ qua note "Personal").
  const deletedWorkspaceId = result[0]?.workspaceId;
  if (deletedWorkspaceId) {
    await onWorkspaceContentChanged(session.user.id, deletedWorkspaceId);
  }

  return NextResponse.json({ deleted: true });
}
