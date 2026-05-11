/**
 * /api/workspaces/[id] — rename (PATCH) + delete (DELETE).
 *
 * Không xoá được workspace cuối cùng để tránh document orphan (FK NOT NULL).
 * Khi xoá: documents trong workspace bị cascade xoá (theo schema FK).
 *
 * PATCH body: { name?, description? }.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, workspace } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

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
  return NextResponse.json({ deleted: true });
}
