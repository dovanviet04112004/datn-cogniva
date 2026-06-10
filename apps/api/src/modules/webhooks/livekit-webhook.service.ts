/**
 * LivekitWebhookService — xử lý webhook từ LiveKit Server.
 * Port từ apps/web/src/app/api/webhooks/livekit/route.ts.
 *
 * Authorization header = JWT ký HMAC bằng LIVEKIT_API_SECRET; receive() của
 * livekit-server-sdk verify cả chữ ký lẫn claim sha256 của RAW body — vì vậy
 * controller phải đưa req.rawBody (main.ts bật rawBody:true), parse JSON
 * trước là vỡ verify.
 */
import { randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';
import { RECORDING_QUEUE } from '../../infra/queue/queue.module';
import { RecordingPipelineService } from '../channels/recording-pipeline.service';

/** Build public URL từ R2 key — NGUỒN CHUẨN ở apps/web/src/lib/r2-url.ts. */
function buildR2PublicUrl(filename: string): string {
  if (!filename) return '';
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (publicUrl) {
    return `${publicUrl.replace(/\/+$/, '')}/${filename.replace(/^\/+/, '')}`;
  }
  // Fallback: internal endpoint — chỉ download được nếu có credentials
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME ?? 'cogniva-recordings';
  if (!accountId) return filename;
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${filename}`;
}

/** Ưu tiên filename (URL public play được) → location → null nếu egress fail thật. */
function resolveEgressFileUrl(input: {
  filename?: string | null;
  location?: string | null;
}): string | null {
  if (input.filename) return buildR2PublicUrl(input.filename);
  if (input.location) return input.location;
  return null;
}

@Injectable()
export class LivekitWebhookService {
  private receiver: WebhookReceiver | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: RecordingPipelineService,
    @InjectQueue(RECORDING_QUEUE) private readonly recordingQueue: Queue,
  ) {}

  /** Lazy receiver — env thiếu thì throw, catch ở handle() trả 401 y bản cũ. */
  private getReceiver(): WebhookReceiver {
    if (this.receiver) return this.receiver;
    const key = process.env.LIVEKIT_API_KEY;
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!key || !secret) throw new Error('LiveKit env not configured');
    this.receiver = new WebhookReceiver(key, secret);
    return this.receiver;
  }

  async handle(rawBody: string, authHeader: string | undefined) {
    if (!authHeader) throw new UnauthorizedException({ error: 'Missing auth' });

    let event: WebhookEvent;
    try {
      event = await this.getReceiver().receive(rawBody, authHeader);
    } catch (err) {
      console.error('[livekit-webhook] verify fail:', err);
      throw new UnauthorizedException({ error: 'Invalid signature' });
    }

    const roomName = event.room?.name;
    if (!roomName) {
      return { ok: true, skipped: 'no room name' };
    }

    // Route theo prefix: `group:XXX` → study group voice channel webhook.
    // Còn lại fallthrough qua xử lý room cũ (Phase 13 standalone rooms).
    if (await this.handleGroupVoiceEvent(roomName, event)) {
      return { ok: true, kind: 'group-voice' };
    }

    // roomName = room.id theo convention (xem POST /api/rooms)
    switch (event.event) {
      case 'room_started':
        await this.prisma.room.updateMany({
          where: { id: roomName },
          data: { status: 'ACTIVE', started_at: new Date() },
        });
        break;

      case 'room_finished':
        await this.prisma.room.updateMany({
          where: { id: roomName },
          data: { status: 'ENDED', ended_at: new Date() },
        });
        break;

      case 'participant_joined':
        if (event.participant?.identity) {
          await this.prisma.room_event.create({
            data: {
              id: randomUUID(),
              room_id: roomName,
              user_id: event.participant.identity,
              type: 'JOINED',
              metadata: { name: event.participant.name },
            },
          });
        }
        break;

      case 'participant_left':
        if (event.participant?.identity) {
          await this.prisma.room_event.create({
            data: {
              id: randomUUID(),
              room_id: roomName,
              user_id: event.participant.identity,
              type: 'LEFT',
            },
          });
          await this.prisma.room_member.updateMany({
            where: { room_id: roomName, user_id: event.participant.identity },
            data: { last_seen_at: new Date() },
          });
        }
        break;

      case 'egress_started': {
        // Đã set RECORDING khi POST /record — ở đây chỉ confirm + log.
        const egressId = event.egressInfo?.egressId;
        if (egressId) {
          console.log(`[livekit-webhook] egress_started ${egressId} for ${roomName}`);
        }
        break;
      }

      case 'egress_ended':
        await this.handleEgressEnded(event);
        break;
    }

    return { ok: true };
  }

  /**
   * Group voice channel có roomName convention `group:{channelId}`.
   * Webhook nhận sự kiện → sync `study_group_voice_state` + broadcast presence-voice.
   */
  private async handleGroupVoiceEvent(
    roomName: string,
    event: WebhookEvent,
  ): Promise<boolean> {
    if (!roomName.startsWith('group:')) return false;
    const channelId = roomName.slice('group:'.length);

    // Verify channel còn tồn tại (có thể đã bị delete)
    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });
    if (!ch) return true;

    switch (event.event) {
      case 'participant_joined': {
        const uid = event.participant?.identity;
        if (!uid) break;
        await this.prisma.study_group_voice_state.upsert({
          where: { user_id: uid },
          create: { user_id: uid, channel_id: channelId },
          update: {
            channel_id: channelId,
            joined_at: new Date(),
            self_muted: false,
            server_muted: false,
            camera: false,
            screen_share: false,
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
        await this.prisma.study_group_voice_state.deleteMany({
          where: { user_id: uid, channel_id: channelId },
        });
        void triggerEvent(`presence-voice-${channelId}`, 'voice:leave', { userId: uid });
        break;
      }
      case 'room_finished':
        // Clear toàn bộ state cho channel (mọi participant đã out)
        await this.prisma.study_group_voice_state.deleteMany({
          where: { channel_id: channelId },
        });
        break;
    }
    return true;
  }

  private async handleEgressEnded(event: WebhookEvent): Promise<void> {
    const info = event.egressInfo;
    const egressId = info?.egressId;
    if (!egressId) return;

    // Tìm recording row theo egressId — có thể thuộc về room HOẶC voice channel
    const rec = await this.prisma.recording.findUnique({
      where: { egress_id: egressId },
      select: { id: true, room_id: true, study_group_channel_id: true, storage_key: true },
    });
    if (!rec) {
      console.warn(`[livekit-webhook] egress_ended không tìm thấy recording ${egressId}`);
      return;
    }

    // Extract fileUrl + size từ egressInfo.fileResults.
    // Ưu tiên storageKey lưu sẵn lúc start record (reliable nhất).
    const fileResult = info?.fileResults?.[0];
    const fileUrl = rec.storage_key
      ? buildR2PublicUrl(rec.storage_key)
      : resolveEgressFileUrl({
          filename: fileResult?.filename,
          location: fileResult?.location,
        });
    const fileSize = fileResult?.size ? Number(fileResult.size) : null;
    // egressInfo.startedAt/endedAt là timestamp NANOSECOND (bigint)
    const duration =
      info?.endedAt && info?.startedAt
        ? Math.round((Number(info.endedAt) - Number(info.startedAt)) / 1_000_000_000)
        : null;

    await this.prisma.recording.update({
      where: { id: rec.id },
      data: {
        status: 'PROCESSING',
        file_url: fileUrl,
        file_size_bytes: fileSize,
        duration_seconds: duration,
        ended_at: new Date(),
      },
    });

    // Pipeline trigger: channel recording chạy inline fire-and-forget (pipeline
    // KHÔNG throw — fail tự set DB FAILED, user retry qua /sync); room recording
    // enqueue BullMQ — jobId=recordingId dedup với producer cũ ở web (dual window).
    if (fileUrl) {
      if (rec.study_group_channel_id) {
        void this.pipeline.run({
          recordingId: rec.id,
          fileUrl,
          channelId: rec.study_group_channel_id,
          durationHint: duration ?? undefined,
        });
      } else if (rec.room_id) {
        await this.recordingQueue.add(
          'process',
          {
            recordingId: rec.id,
            egressId,
            r2Key: fileResult?.filename ?? '',
            fileUrl,
            roomId: rec.room_id,
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
      await this.prisma.recording.update({
        where: { id: rec.id },
        data: { status: 'FAILED' },
      });
    }

    // Notify UI realtime — route đúng channel tuỳ owner
    if (rec.study_group_channel_id) {
      await triggerEvent(`presence-voice-${rec.study_group_channel_id}`, 'recording:ended', {
        recordingId: rec.id,
        fileUrl,
      });
    } else if (rec.room_id) {
      await triggerEvent(`presence-room-${rec.room_id}`, 'recording:ended', {
        recordingId: rec.id,
        fileUrl,
      });
    }
  }
}
