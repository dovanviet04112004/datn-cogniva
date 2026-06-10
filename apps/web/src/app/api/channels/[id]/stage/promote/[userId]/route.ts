/**
 * POST /api/channels/[id]/stage/promote/[userId] — mod promote audience → speaker.
 *
 * Flow:
 *   1. Verify mod permission.
 *   2. UPDATE DB: role='SPEAKER', clear raisedAt, set promotedAt.
 *   3. Update LiveKit participant permission `canPublish=true` (hot — không
 *      cần reconnect, LiveKit broadcast permission update tới client).
 *   4. Broadcast realtime `stage:promoted` để UI refetch.
 *
 * Auth: chỉ OWNER/ADMIN/MODERATOR.
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
  if (!me || !['OWNER', 'ADMIN', 'MODERATOR'].includes(me.role)) {
    return NextResponse.json({ error: 'Chỉ mod được promote' }, { status: 403 });
  }

  // Verify target là member của group (chống promote user ngoài group)
  const [target] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, targetUserId),
      ),
    )
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: 'User không phải member group' }, { status: 400 });
  }

  // UPDATE DB
  await db
    .insert(studyGroupStageRole)
    .values({
      channelId,
      userId: targetUserId,
      role: 'SPEAKER',
      raisedAt: null,
      promotedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [studyGroupStageRole.userId, studyGroupStageRole.channelId],
      set: { role: 'SPEAKER', raisedAt: null, promotedAt: new Date() },
    });

  // Hot-update LiveKit permission — best-effort, ignore nếu user chưa join room
  if (ch.livekitRoomName) {
    try {
      await getRoomService().updateParticipant(
        ch.livekitRoomName,
        targetUserId,
        undefined,
        new ParticipantPermission({
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        }),
      );
    } catch (err) {
      // User chưa join hoặc đã rời — không sao, lần join tới token mới sẽ có canPublish
      console.warn('[stage/promote] LiveKit update fail (user offline?):', err);
    }
  }

  // Broadcast cho audience UI + speaker UI refetch state
  await triggerEvent(`presence-voice-${channelId}`, 'stage:promoted', {
    userId: targetUserId,
    byUserId: session.user.id,
  });

  return NextResponse.json({ ok: true });
}
