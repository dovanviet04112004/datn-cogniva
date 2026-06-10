/**
 * GET /api/channels/[id]/voice/participants — list user đang trong VOICE channel.
 *
 * Source: study_group_voice_state (DB mirror cập nhật từ LiveKit webhook).
 * Trả {userId, name, image, selfMuted, serverMuted, camera, screenShare, joinedAt}.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupVoiceState,
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

  const [channel] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!channel) return NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 });

  const [member] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, channel.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const participants = await db
    .select({
      userId: studyGroupVoiceState.userId,
      name: userTable.name,
      image: userTable.image,
      selfMuted: studyGroupVoiceState.selfMuted,
      serverMuted: studyGroupVoiceState.serverMuted,
      camera: studyGroupVoiceState.camera,
      screenShare: studyGroupVoiceState.screenShare,
      joinedAt: studyGroupVoiceState.joinedAt,
    })
    .from(studyGroupVoiceState)
    .innerJoin(userTable, eq(userTable.id, studyGroupVoiceState.userId))
    .where(eq(studyGroupVoiceState.channelId, channelId));

  return NextResponse.json({ participants });
}
