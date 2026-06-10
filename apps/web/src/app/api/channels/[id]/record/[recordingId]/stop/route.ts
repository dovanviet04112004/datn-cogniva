/**
 * POST /api/channels/[id]/record/[recordingId]/stop — Mod stop active recording.
 *
 * Tương tự room/stop nhưng cho VOICE channel của study group.
 * Idempotent — call 2 lần OK (LiveKit 404 lần 2 → swallow).
 *
 * Sau stop:
 *   - DB set status='PROCESSING' + endedAt
 *   - Webhook livekit `egress_ended` sẽ pickup → trigger recording pipeline
 *   - Broadcast `presence-voice-{channelId}` event `recording:stopped`
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { EgressClient } from 'livekit-server-sdk';

import {
  db,
  recording,
  studyGroupChannel,
  studyGroupMember,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, type GroupRole } from '@/lib/group/permissions';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; recordingId: string }> };

let _egressClient: EgressClient | null = null;
function getEgressClient(): EgressClient {
  if (_egressClient) return _egressClient;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) throw new Error('LiveKit env missing');
  _egressClient = new EgressClient(url, apiKey, apiSecret);
  return _egressClient;
}

export async function POST(_req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: channelId, recordingId } = await params;

  // Verify mod permission
  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

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
  if (!member || !can(member.role as GroupRole, 'voice.record')) {
    return NextResponse.json(
      { error: 'Chỉ mod/admin/owner mới được stop record' },
      { status: 403 },
    );
  }

  const [rec] = await db
    .select({ egressId: recording.egressId, status: recording.status })
    .from(recording)
    .where(
      and(eq(recording.id, recordingId), eq(recording.studyGroupChannelId, channelId)),
    )
    .limit(1);
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  if (!rec.egressId) {
    return NextResponse.json(
      { error: 'Recording không có egressId — không stop được' },
      { status: 400 },
    );
  }
  if (rec.status !== 'RECORDING') {
    return NextResponse.json({ ok: true, alreadyStopped: true });
  }

  try {
    await getEgressClient().stopEgress(rec.egressId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/not.found|404/i.test(msg)) {
      console.error(`[channel/record/stop] egressId=${rec.egressId}:`, msg);
      return NextResponse.json({ error: `Egress stop fail: ${msg}` }, { status: 500 });
    }
  }

  await db
    .update(recording)
    .set({ status: 'PROCESSING', endedAt: new Date() })
    .where(eq(recording.id, recordingId));

  await triggerEvent(`presence-voice-${channelId}`, 'recording:stopped', {
    recordingId,
    byUserId: session.user.id,
    byUserName: session.user.name,
  });

  return NextResponse.json({ ok: true });
}
