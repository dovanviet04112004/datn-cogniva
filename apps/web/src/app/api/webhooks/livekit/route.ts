/**
 * Webhook receiver từ LiveKit Server.
 *
 * LiveKit gửi POST với Authorization header = signed JWT (HMAC SHA256
 * dùng API secret). `WebhookReceiver.receive()` verify chữ ký → throw nếu fail.
 *
 * Events handle:
 *   - room_started        : update room.status = ACTIVE + startedAt
 *   - room_finished       : update room.status = ENDED + endedAt + Inngest hook
 *   - participant_joined  : insert room_event JOINED
 *   - participant_left    : insert room_event LEFT, update member.lastSeenAt
 *   - egress_started      : update recording.status = RECORDING (Phase 15)
 *   - egress_ended        : update recording + trigger transcribe job (Phase 15)
 *
 * Lưu ý dev: LiveKit không thể POST tới http://localhost:3000 nếu chạy trong
 * container. Hai cách:
 *   1. Bỏ webhook URL trong livekit.dev.yaml (đã làm) — Phase 13/14 không cần
 *      webhook hoàn hảo, room.status update có thể bỏ qua tới khi prod.
 *   2. Dùng ngrok/cloudflared expose dev server → set webhook URL.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { WebhookReceiver } from 'livekit-server-sdk';
import { eq, and } from 'drizzle-orm';

import { db, recording, room, roomEvent, roomMember } from '@cogniva/db';

import { inngest } from '@/inngest/client';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

let _receiver: WebhookReceiver | null = null;
function getReceiver(): WebhookReceiver {
  if (_receiver) return _receiver;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) throw new Error('LiveKit env not configured');
  _receiver = new WebhookReceiver(key, secret);
  return _receiver;
}

export async function POST(req: Request) {
  const body = await req.text();
  const authHeader = (await headers()).get('Authorization');
  if (!authHeader) return NextResponse.json({ error: 'Missing auth' }, { status: 401 });

  let event;
  try {
    event = await getReceiver().receive(body, authHeader);
  } catch (err) {
    console.error('[livekit-webhook] verify fail:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const roomName = event.room?.name;
  if (!roomName) {
    return NextResponse.json({ ok: true, skipped: 'no room name' });
  }

  // roomName = room.id theo convention (xem POST /api/rooms)
  switch (event.event) {
    case 'room_started':
      await db
        .update(room)
        .set({ status: 'ACTIVE', startedAt: new Date() })
        .where(eq(room.id, roomName));
      break;

    case 'room_finished':
      await db
        .update(room)
        .set({ status: 'ENDED', endedAt: new Date() })
        .where(eq(room.id, roomName));
      // Phase 15 sẽ trigger AI summary job ở đây
      break;

    case 'participant_joined':
      if (event.participant?.identity) {
        await db.insert(roomEvent).values({
          roomId: roomName,
          userId: event.participant.identity,
          type: 'JOINED',
          metadata: { name: event.participant.name },
        });
      }
      break;

    case 'participant_left':
      if (event.participant?.identity) {
        await db.insert(roomEvent).values({
          roomId: roomName,
          userId: event.participant.identity,
          type: 'LEFT',
        });
        await db
          .update(roomMember)
          .set({ lastSeenAt: new Date() })
          .where(
            and(
              eq(roomMember.roomId, roomName),
              eq(roomMember.userId, event.participant.identity),
            ),
          );
      }
      break;

    case 'track_published':
      // Phase 14 — analytics screen share, etc.
      break;

    case 'egress_started': {
      // Note: ta đã set RECORDING khi POST /record. Ở đây chỉ confirm + log.
      const egressId = event.egressInfo?.egressId;
      if (egressId) {
        console.log(`[livekit-webhook] egress_started ${egressId} for ${roomName}`);
      }
      break;
    }

    case 'egress_ended': {
      const info = event.egressInfo;
      const egressId = info?.egressId;
      if (!egressId) break;

      // Tìm recording row theo egressId
      const [rec] = await db
        .select({
          id: recording.id,
          roomId: recording.roomId,
        })
        .from(recording)
        .where(eq(recording.egressId, egressId))
        .limit(1);
      if (!rec) {
        console.warn(`[livekit-webhook] egress_ended không tìm thấy recording ${egressId}`);
        break;
      }

      // Extract fileUrl + size từ egressInfo.fileResults (S3 location)
      const fileResult = info?.fileResults?.[0];
      const fileUrl = fileResult?.location ?? null;
      const fileSize = fileResult?.size ? Number(fileResult.size) : null;
      const duration = info?.endedAt && info?.startedAt
        ? Math.round((Number(info.endedAt) - Number(info.startedAt)) / 1_000_000_000)
        : null;

      await db
        .update(recording)
        .set({
          status: 'PROCESSING',
          fileUrl,
          fileSize,
          duration,
          endedAt: new Date(),
        })
        .where(eq(recording.id, rec.id));

      // Fire Inngest event để pipeline pickup
      if (fileUrl) {
        await inngest.send({
          name: 'recording/finished',
          data: {
            recordingId: rec.id,
            egressId,
            r2Key: fileResult?.filename ?? '',
            fileUrl,
            roomId: rec.roomId,
            duration: duration ?? undefined,
            fileSize: fileSize ?? undefined,
          },
        });
      } else {
        // Egress success nhưng không có fileUrl → coi như fail
        await db
          .update(recording)
          .set({ status: 'FAILED' })
          .where(eq(recording.id, rec.id));
      }

      // Notify UI realtime
      await triggerEvent(`presence-room-${roomName}`, 'recording:ended', {
        recordingId: rec.id,
        fileUrl,
      });
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
