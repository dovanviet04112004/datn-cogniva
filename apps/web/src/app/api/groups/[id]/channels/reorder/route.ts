/**
 * POST /api/groups/[id]/channels/reorder — drag-drop reorder bulk.
 *
 * Body: { orders: [{ id: string, position: number }, ...] }
 * ADMIN+ mới được. Mỗi entry verify channel thuộc group này trước update.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroupChannel, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onGroupChanged } from '@/lib/cache/invalidate';
import { can, type GroupRole } from '@/lib/group/permissions';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  orders: z
    .array(
      z.object({
        id: z.string().min(1),
        position: z.number().int().min(0).max(10_000),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
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
  if (!can(me.role as GroupRole, 'channel.reorder')) {
    return NextResponse.json({ error: 'Không có quyền sắp xếp' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Bulk update trong txn — đảm bảo channel thuộc đúng group
  await db.transaction(async (tx) => {
    for (const { id, position } of parsed.data.orders) {
      await tx
        .update(studyGroupChannel)
        .set({ position })
        .where(and(eq(studyGroupChannel.id, id), eq(studyGroupChannel.groupId, groupId)));
    }
  });

  // Position channels đổi → groupDetail (channels sorted by position) phải tươi lại.
  await onGroupChanged(groupId);

  return NextResponse.json({ updated: parsed.data.orders.length });
}
