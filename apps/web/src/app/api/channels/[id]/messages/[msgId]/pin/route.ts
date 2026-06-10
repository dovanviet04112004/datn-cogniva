/**
 * POST   /api/channels/[id]/messages/[msgId]/pin — toggle pin message.
 *
 * MODERATOR+ mới được. Pin để render đầu channel header. Broadcast realtime
 * `message:pin` event để các client cập nhật banner.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupMessage,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, type GroupRole } from '@/lib/group/permissions';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const { id: channelId, msgId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 });

  const [member] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!can(member.role as GroupRole, 'message.pin')) {
    return NextResponse.json({ error: 'Không có quyền pin' }, { status: 403 });
  }

  const [msg] = await db
    .select({ pinned: studyGroupMessage.pinned })
    .from(studyGroupMessage)
    .where(and(eq(studyGroupMessage.id, msgId), eq(studyGroupMessage.channelId, channelId)))
    .limit(1);
  if (!msg) return NextResponse.json({ error: 'Message không tồn tại' }, { status: 404 });

  const newPinned = !msg.pinned;
  await db
    .update(studyGroupMessage)
    .set({ pinned: newPinned })
    .where(eq(studyGroupMessage.id, msgId));

  void triggerEvent(`private-channel-${channelId}`, 'message:pin', {
    id: msgId,
    pinned: newPinned,
  });

  return NextResponse.json({ pinned: newPinned });
}
