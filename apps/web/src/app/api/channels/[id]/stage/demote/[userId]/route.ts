/**
 * POST /api/channels/[id]/stage/demote/[userId] — mod demote speaker → audience.
 *
 * Khác promote:
 *   - Set role='AUDIENCE', clear promotedAt.
 *   - LiveKit permission `canPublish=false` → auto-unpublish các track đang phát.
 *
 * Self-demote: user có thể tự demote (rời stage). Mod có thể demote bất kỳ.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { ParticipantPermission } from 'livekit-server-sdk';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupStageRole,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { getRoomService } from '@/lib/livekit';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; userId: string }> };

export async function POST(_req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: channelId, userId: targetUserId } = await params;

  const [ch] = await db
    .select()
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch || ch.type !== 'STAGE') {
    return NextResponse.json({ error: 'Stage channel không tồn tại' }, { status: 404 });
  }

  const [me] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Cho phép self-demote (rời stage tự nguyện) hoặc mod demote người khác
  const isSelf = targetUserId === session.user.id;
  const isMod = ['OWNER', 'ADMIN', 'MODERATOR'].includes(me.role);
  if (!isSelf && !isMod) {
    return NextResponse.json({ error: 'Chỉ mod được demote người khác' }, { status: 403 });
  }

  await db
    .insert(studyGroupStageRole)
    .values({
      channelId,
      userId: targetUserId,
      role: 'AUDIENCE',
      raisedAt: null,
      promotedAt: null,
    })
    .onConflictDoUpdate({
      target: [studyGroupStageRole.userId, studyGroupStageRole.channelId],
      set: { role: 'AUDIENCE', raisedAt: null, promotedAt: null },
    });

  if (ch.livekitRoomName) {
    try {
      await getRoomService().updateParticipant(
        ch.livekitRoomName,
        targetUserId,
        undefined,
        new ParticipantPermission({
          canPublish: false,
          canSubscribe: true,
          canPublishData: true,
        }),
      );
    } catch (err) {
      console.warn('[stage/demote] LiveKit update fail:', err);
    }
  }

  await triggerEvent(`presence-voice-${channelId}`, 'stage:demoted', {
    userId: targetUserId,
    byUserId: session.user.id,
  });

  return NextResponse.json({ ok: true });
}
