/**
 * Webhook receiver từ LiveKit Server.
 *
 * LiveKit gửi POST với Authorization header = signed JWT (HMAC SHA256
 * dùng API secret). `WebhookReceiver.receive()` verify chữ ký → throw nếu fail.
 *
 * Events handle:
 *   - room_started        : update room.status = ACTIVE + startedAt
 *   - room_finished       : update room.status = ENDED + endedAt + BullMQ hook
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

// Pipeline có thể chạy 1-3 phút (Whisper transcribe). Cần extend timeout.
export const maxDuration = 300;

import {
  db,
  recording,
  room,
  roomEvent,
  roomMember,
  studyGroupChannel,
  studyGroupVoiceState,
} from '@cogniva/db';

import { getRecordingQueue } from '@/queue/queues';
import { triggerEvent } from '@/lib/realtime-server';
import { buildR2PublicUrl, resolveEgressFileUrl } from '@/lib/r2-url';
import { runRecordingPipeline } from '@/lib/recording/inline-pipeline';

export const runtime = 'nodejs';

/**
 * Group voice channel có roomName convention `group:{channelId}`.
 * Webhook nhận sự kiện → sync `study_group_voice_state` + broadcast presence-voice.
 */
async function handleGroupVoiceEvent(roomName: string, event: {
  event: string;
  participant?: { identity?: string; name?: string };
}): Promise<boolean> {
  if (!roomName.startsWith('group:')) return false;
  const channelId = roomName.slice('group:'.length);

  // Verify channel còn tồn tại (có thể đã bị delete)
  const [ch] = await db
    .select({ id: studyGroupChannel.id })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return true;

  switch (event.event) {
    case 'participant_joined': {
      const uid = event.participant?.identity;
      if (!uid) break;
      await db
        .insert(studyGroupVoiceState)
        .values({ userId: uid, channelId })
        .onConflictDoUpdate({
          target: studyGroupVoiceState.userId,
          set: {
            channelId,
            joinedAt: new Date(),
            selfMuted: false,
            serverMuted: false,
            camera: false,
            screenShare: false,
          },
        });
      void triggerEvent(`presence-voice-${channelId}`, 'voice:join', {
        userId: uid,
        userName: event.participant?.name ?? '',
      });
      break;
    }
    case 'participant_left': {
      const uid = event.participant?.identity;
      if (!uid) break;
      await db
        .delete(studyGroupVoiceState)
        .where(
          and(
            eq(studyGroupVoiceState.userId, uid),
            eq(studyGroupVoiceState.channelId, channelId),
          ),
        );
      void triggerEvent(`presence-voice-${channelId}`, 'voice:leave', { userId: uid });
      break;
    }
    case 'room_finished':
      // Clear toàn bộ state cho channel (mọi participant đã out)
      await db
        .delete(studyGroupVoiceState)
        .where(eq(studyGroupVoiceState.channelId, channelId));
      break;
  }
  return true;
}

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

  // Route theo prefix: `group:XXX` → study group voice channel webhook.
  // Còn lại fallthrough qua xử lý room cũ (Phase 13 standalone rooms).
  if (await handleGroupVoiceEvent(roomName, event)) {
    return NextResponse.json({ ok: true, kind: 'group-voice' });
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

      // Tìm recording row theo egressId — có thể thuộc về room HOẶC voice channel
      const [rec] = await db
        .select({
          id: recording.id,
          roomId: recording.roomId,
          channelId: recording.studyGroupChannelId,
          storageKey: recording.storageKey,
        })
        .from(recording)
        .where(eq(recording.egressId, egressId))
        .limit(1);
      if (!rec) {
        console.warn(`[livekit-webhook] egress_ended không tìm thấy recording ${egressId}`);
        break;
      }

      // Extract fileUrl + size từ egressInfo.fileResults.
      // Ưu tiên storageKey lưu sẵn lúc start record (reliable nhất).
      const fileResult = info?.fileResults?.[0];
      const fileUrl = rec.storageKey
        ? buildR2PublicUrl(rec.storageKey)
        : resolveEgressFileUrl({
            filename: fileResult?.filename,
            location: fileResult?.location,
          });
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

      // Pipeline trigger: với channel recording chạy inline (không cần worker),
      // với room recording enqueue BullMQ job (worker xử lý async).
      if (fileUrl) {
        if (rec.channelId) {
          // Run inline pipeline (sync) — không cần worker chạy parallel
          // Webhook chờ pipeline xong rồi trả 200. Nếu fail, /sync endpoint
          // cho phép user retry tay từ UI.
          void runRecordingPipeline({
            recordingId: rec.id,
            fileUrl,
            channelId: rec.channelId,
            durationHint: duration ?? undefined,
          });
        } else if (rec.roomId) {
          // Enqueue BullMQ — jobId=recordingId để dedup (cùng recording không double-enqueue).
          await getRecordingQueue().add(
            'process',
            {
              recordingId: rec.id,
              egressId,
              r2Key: fileResult?.filename ?? '',
              fileUrl,
              roomId: rec.roomId,
              duration: duration ?? undefined,
              fileSize: fileSize ?? undefined,
            },
            {
              jobId: rec.id,
              attempts: 2,
              backoff: { type: 'exponential', delay: 30_000 },
              removeOnComplete: 100,
              removeOnFail: 500,
            },
          );
        }
      } else {
        await db
          .update(recording)
          .set({ status: 'FAILED' })
          .where(eq(recording.id, rec.id));
      }

      // Notify UI realtime — route đúng channel tuỳ owner
      if (rec.channelId) {
        await triggerEvent(`presence-voice-${rec.channelId}`, 'recording:ended', {
          recordingId: rec.id,
          fileUrl,
        });
      } else if (rec.roomId) {
        await triggerEvent(`presence-room-${rec.roomId}`, 'recording:ended', {
          recordingId: rec.id,
          fileUrl,
        });
      }
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
