/**
 * POST /api/rooms/[id]/record/[recordingId]/stop — Mod stop active recording.
 *
 * Gọi `stopEgress(egressId)` — LiveKit ngừng compose + flush MP4 cuối cùng
 * lên R2. Webhook `egress_ended` sẽ update fileUrl/status sau, không phải
 * route này.
 *
 * Idempotent: gọi 2 lần OK (LiveKit trả 404 lần 2, ta swallow).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { EgressClient } from 'livekit-server-sdk';

import { db, recording, roomMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
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

  const { id: roomId, recordingId } = await params;

  // Verify mod
  const [m] = await db
    .select({ role: roomMember.role, status: roomMember.status })
    .from(roomMember)
    .where(and(eq(roomMember.roomId, roomId), eq(roomMember.userId, session.user.id)))
    .limit(1);
  if (!m || m.status !== 'ACTIVE' || (m.role !== 'OWNER' && m.role !== 'MODERATOR')) {
    return NextResponse.json({ error: 'Chỉ mod/owner mới được stop record' }, { status: 403 });
  }

  // Load recording
  const [rec] = await db
    .select({ egressId: recording.egressId, status: recording.status })
    .from(recording)
    .where(and(eq(recording.id, recordingId), eq(recording.roomId, roomId)))
    .limit(1);
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  if (!rec.egressId) {
    return NextResponse.json({ error: 'Recording không có egressId — không stop được' }, { status: 400 });
  }
  if (rec.status !== 'RECORDING') {
    // Idempotent: đã stop rồi → trả ok
    return NextResponse.json({ ok: true, alreadyStopped: true });
  }

  try {
    await getEgressClient().stopEgress(rec.egressId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 404 từ LiveKit = egress đã kết thúc rồi → swallow
    if (!/not.found|404/i.test(msg)) {
      console.error(`[record/stop] egressId=${rec.egressId}:`, msg);
      return NextResponse.json({ error: `Egress stop fail: ${msg}` }, { status: 500 });
    }
  }

  // Update intermediate state — webhook sẽ chuyển sang PROCESSING/PROCESSED
  await db
    .update(recording)
    .set({ status: 'PROCESSING', endedAt: new Date() })
    .where(eq(recording.id, recordingId));

  await triggerEvent(`presence-room-${roomId}`, 'recording:stopped', {
    recordingId,
    byUserId: session.user.id,
    byUserName: session.user.name,
  });

  return NextResponse.json({ ok: true });
}
