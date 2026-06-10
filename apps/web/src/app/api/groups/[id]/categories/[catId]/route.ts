/**
 * /api/groups/[id]/categories/[catId] — update name + delete.
 *
 * DELETE: xoá category → channel.category_id auto SET NULL (FK constraint).
 *         Channels không bị xoá theo, chỉ thoát khỏi category.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroupCategory, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onGroupChanged } from '@/lib/cache/invalidate';
import { can, type GroupRole } from '@/lib/group/permissions';

export const runtime = 'nodejs';

const UPDATE_SCHEMA = z.object({
  name: z.string().min(1).max(80).optional(),
  position: z.number().int().min(0).optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; catId: string }> },
) {
  const { id: groupId, catId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [me] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  if (!can(me.role as GroupRole, 'channel.update')) {
    return NextResponse.json({ error: 'Không có quyền sửa category' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = UPDATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(studyGroupCategory)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.position !== undefined && { position: parsed.data.position }),
    })
    .where(
      and(eq(studyGroupCategory.id, catId), eq(studyGroupCategory.groupId, groupId)),
    )
    .returning();
  if (!updated) return NextResponse.json({ error: 'Category không tồn tại' }, { status: 404 });
  return NextResponse.json({ category: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; catId: string }> },
) {
  const { id: groupId, catId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [me] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  if (!can(me.role as GroupRole, 'channel.delete')) {
    return NextResponse.json({ error: 'Không có quyền xoá category' }, { status: 403 });
  }

  const result = await db
    .delete(studyGroupCategory)
    .where(
      and(eq(studyGroupCategory.id, catId), eq(studyGroupCategory.groupId, groupId)),
    )
    .returning({ id: studyGroupCategory.id });
  if (result.length === 0) {
    return NextResponse.json({ error: 'Category không tồn tại' }, { status: 404 });
  }

  // Xoá category → FK SET NULL trên channel.category_id → channel rows đổi, mà
  // channels nằm trong groupDetail cache → bust để member khác thấy channel "thoát"
  // khỏi category.
  await onGroupChanged(groupId);

  return NextResponse.json({ deleted: true });
}
