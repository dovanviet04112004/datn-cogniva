/**
 * GET /api/channels/[id]/messages/[msgId]/history — list edit revisions.
 *
 * Spec V2 G2.7: docs/plans/study-group-v2.md §G2.
 *
 * Trả timeline content qua các lần edit, sort `editedAt` DESC (mới nhất trên).
 * Bao gồm cả content current (từ studyGroupMessage) như là phiên bản hiện tại.
 *
 * Auth: member của group chứa channel. Editor (author + MOD) đều xem được.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupMessage,
  studyGroupMessageRevision,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const { id: channelId, msgId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [msg] = await db
    .select({
      content: studyGroupMessage.content,
      editedAt: studyGroupMessage.editedAt,
      createdAt: studyGroupMessage.createdAt,
      channelId: studyGroupMessage.channelId,
    })
    .from(studyGroupMessage)
    .where(eq(studyGroupMessage.id, msgId))
    .limit(1);
  if (!msg || msg.channelId !== channelId) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  // Verify member của group
  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

  const [member] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const revisions = await db
    .select({
      id: studyGroupMessageRevision.id,
      content: studyGroupMessageRevision.content,
      editedAt: studyGroupMessageRevision.editedAt,
    })
    .from(studyGroupMessageRevision)
    .where(eq(studyGroupMessageRevision.messageId, msgId))
    .orderBy(desc(studyGroupMessageRevision.editedAt))
    .limit(50);

  // Compose timeline: current trên cùng, revisions sau
  return NextResponse.json({
    current: {
      content: msg.content,
      editedAt: msg.editedAt,
      createdAt: msg.createdAt,
    },
    revisions,
  });
}
