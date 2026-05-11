/**
 * /api/groups/[id] — chi tiết group + members + delete.
 *
 * GET: trả group + members (name, role, joinedAt). Chỉ member mới được xem.
 * DELETE: xoá group, cascade members. Chỉ OWNER mới được.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';

import { db, studyGroup, studyGroupMember, user } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify user là member
  const [mine] = await db
    .select()
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, id), eq(studyGroupMember.userId, session.user.id)),
    )
    .limit(1);
  if (!mine) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const [group] = await db
    .select()
    .from(studyGroup)
    .where(eq(studyGroup.id, id))
    .limit(1);
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const members = await db
    .select({
      userId: studyGroupMember.userId,
      name: user.name,
      image: user.image,
      role: studyGroupMember.role,
      joinedAt: studyGroupMember.joinedAt,
    })
    .from(studyGroupMember)
    .innerJoin(user, eq(user.id, studyGroupMember.userId))
    .where(eq(studyGroupMember.groupId, id))
    .orderBy(asc(studyGroupMember.joinedAt));

  return NextResponse.json({ group, members, myRole: mine.role });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await db
    .delete(studyGroup)
    .where(and(eq(studyGroup.id, id), eq(studyGroup.ownerUserId, session.user.id)))
    .returning({ id: studyGroup.id });
  if (result.length === 0) {
    return NextResponse.json({ error: 'Not owner or not found' }, { status: 403 });
  }
  return NextResponse.json({ deleted: true });
}
