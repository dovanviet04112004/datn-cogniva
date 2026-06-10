/**
 * /api/workspaces/[id] — GET detail + rename (PATCH) + delete (DELETE).
 *
 * GET trả về meta workspace + list documents trong workspace (kèm chunkCount,
 * status, size) — dùng cho page /workspaces/[id].
 *
 * Không xoá được workspace cuối cùng để tránh document orphan (FK NOT NULL).
 * Khi xoá: documents trong workspace bị cascade xoá (theo schema FK).
 *
 * PATCH body: { name?, description? }.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { chunk, db, document, workspace } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onWorkspaceChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Workspace + verify owner
  const [ws] = await db
    .select()
    .from(workspace)
    .where(and(eq(workspace.id, id), eq(workspace.userId, session.user.id)))
    .limit(1);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Documents trong workspace + chunkCount via subquery aggregate
  const chunkCount = db
    .select({ documentId: chunk.documentId, n: count(chunk.id).as('n') })
    .from(chunk)
    .groupBy(chunk.documentId)
    .as('chunk_count');

  const docs = await db
    .select({
      id: document.id,
      filename: document.filename,
      mimeType: document.mimeType,
      size: document.size,
      status: document.status,
      createdAt: document.createdAt,
      pageCount: sql<number | null>`(${document.metadata}->>'pageCount')::int`,
      chunks: sql<number>`coalesce(${chunkCount.n}, 0)::int`,
    })
    .from(document)
    .leftJoin(chunkCount, eq(document.id, chunkCount.documentId))
    .where(eq(document.workspaceId, id))
    .orderBy(desc(document.createdAt));

  return NextResponse.json({ workspace: ws, documents: docs });
}

const PATCH_SCHEMA = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = PATCH_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(workspace)
    .where(and(eq(workspace.id, id), eq(workspace.userId, session.user.id)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [updated] = await db
    .update(workspace)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description,
      }),
    })
    .where(eq(workspace.id, id))
    .returning();

  // Rename/đổi mô tả → sidebar list (kèm tên) cũ. Bust cache sau update thành công.
  await onWorkspaceChanged(session.user.id);

  return NextResponse.json({ workspace: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Kiểm tra còn workspace nào không — tối thiểu giữ 1 để document có chỗ thuộc
  const all = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.userId, session.user.id));
  if (all.length <= 1) {
    return NextResponse.json(
      { error: 'Phải giữ ít nhất 1 workspace' },
      { status: 400 },
    );
  }

  const result = await db
    .delete(workspace)
    .where(and(eq(workspace.id, id), eq(workspace.userId, session.user.id)))
    .returning({ id: workspace.id });
  if (result.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Workspace bị xoá → sidebar list cũ. Bust cache sau delete thành công.
  await onWorkspaceChanged(session.user.id);

  return NextResponse.json({ deleted: true });
}
