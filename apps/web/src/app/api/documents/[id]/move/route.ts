/**
 * POST /api/documents/[id]/move — chuyển document sang workspace khác.
 *
 * Body: { workspaceId: string } — verify workspace cũng thuộc user.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, document, workspace } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onDocumentChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  workspaceId: z.string(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify document thuộc user. Lấy workspaceId CŨ để invalidate stats/atoms
  // của cả workspace nguồn (doc rời đi) lẫn đích (doc chuyển tới) sau khi move.
  const [doc] = await db
    .select({ id: document.id, workspaceId: document.workspaceId })
    .from(document)
    .where(and(eq(document.id, id), eq(document.userId, session.user.id)))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Verify workspace đích thuộc user
  const [ws] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(
        eq(workspace.id, parsed.data.workspaceId),
        eq(workspace.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!ws) {
    return NextResponse.json({ error: 'Workspace không thuộc bạn' }, { status: 403 });
  }

  await db
    .update(document)
    .set({ workspaceId: parsed.data.workspaceId })
    .where(eq(document.id, id));

  // Bust cache SAU khi move thành công. onDocumentChanged xoá per-user keys
  // (list/sidebar/graph/dashboard) + stats/atoms của 1 workspace. Move chạm 2
  // workspace → gọi cho CẢ nguồn (doc.workspaceId) lẫn đích (workspaceId mới).
  await onDocumentChanged(session.user.id, doc.workspaceId);
  if (doc.workspaceId !== parsed.data.workspaceId) {
    await onDocumentChanged(session.user.id, parsed.data.workspaceId);
  }

  return NextResponse.json({ moved: true });
}
