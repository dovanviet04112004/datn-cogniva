/**
 * GET /api/channels/[id]/pinned — list pinned message của channel.
 *
 * Render trong popover "Pinned messages" cạnh channel header.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupMessage,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 });

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

  const messages = await db
    .select({
      id: studyGroupMessage.id,
      authorId: studyGroupMessage.authorId,
      authorName: userTable.name,
      content: studyGroupMessage.content,
      attachments: studyGroupMessage.attachments,
      createdAt: studyGroupMessage.createdAt,
    })
    .from(studyGroupMessage)
    .innerJoin(userTable, eq(userTable.id, studyGroupMessage.authorId))
    .where(
      and(
        eq(studyGroupMessage.channelId, channelId),
        eq(studyGroupMessage.pinned, true),
        isNull(studyGroupMessage.deletedAt),
      ),
    )
    .orderBy(desc(studyGroupMessage.createdAt))
    .limit(50);

  return NextResponse.json({ pinned: messages });
}
