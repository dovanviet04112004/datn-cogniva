/**
 * DELETE /api/groups/[id]/invites/[code] — revoke invite.
 *
 * MODERATOR+ revoke bất kỳ invite. Member chỉ revoke invite chính mình tạo.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, studyGroupInvite, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, type GroupRole } from '@/lib/group/permissions';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  const { id: groupId, code } = await params;
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

  // Mod+ revoke bất kỳ. Member chỉ revoke invite mình tạo
  const canRevokeAny = can(me.role as GroupRole, 'invite.revoke');

  const [invite] = await db
    .select()
    .from(studyGroupInvite)
    .where(and(eq(studyGroupInvite.groupId, groupId), eq(studyGroupInvite.code, code)))
    .limit(1);
  if (!invite) return NextResponse.json({ error: 'Invite không tồn tại' }, { status: 404 });

  if (!canRevokeAny && invite.createdBy !== session.user.id) {
    return NextResponse.json({ error: 'Chỉ revoke được invite của chính bạn' }, { status: 403 });
  }

  await db.delete(studyGroupInvite).where(eq(studyGroupInvite.id, invite.id));
  return NextResponse.json({ deleted: true });
}
