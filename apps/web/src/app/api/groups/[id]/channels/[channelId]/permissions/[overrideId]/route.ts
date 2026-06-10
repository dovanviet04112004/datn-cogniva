/**
 * DELETE /api/groups/[id]/channels/[channelId]/permissions/[overrideId]
 *
 * Xoá 1 override row. Sau khi xoá, permission cho role/user đó "inherit"
 * hoàn toàn từ role permissions (không có override channel-level).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import {
  db,
  studyGroupChannel,
  studyGroupChannelPermission,
  studyGroupMember,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { hasPermission } from '@/lib/group/effective-permissions';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string; channelId: string; overrideId: string }>;
};

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id: groupId, channelId, overrideId } = await ctx.params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify channel + caller permission
  const [ch] = await db
    .select({ id: studyGroupChannel.id })
    .from(studyGroupChannel)
    .where(
      and(
        eq(studyGroupChannel.id, channelId),
        eq(studyGroupChannel.groupId, groupId),
      ),
    )
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 });

  const [member] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!(await hasPermission(member.id, 'manageChannels'))) {
    return NextResponse.json(
      { error: 'Bạn không có quyền quản lý channel' },
      { status: 403 },
    );
  }

  const result = await db
    .delete(studyGroupChannelPermission)
    .where(
      and(
        eq(studyGroupChannelPermission.id, overrideId),
        eq(studyGroupChannelPermission.channelId, channelId),
      ),
    )
    .returning({ id: studyGroupChannelPermission.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'Override không tồn tại' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
