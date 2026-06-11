import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EgressClient, EncodedFileType, EncodedFileOutput, S3Upload } from 'livekit-server-sdk';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';
import type { AuthUser } from '../../common/auth/session.types';

@Injectable()
export class RoomRecordingsService {
  private readonly logger = new Logger(RoomRecordingsService.name);

  private egressClient: EgressClient | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private getEgressClient(): EgressClient {
    if (this.egressClient) return this.egressClient;
    const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) {
      throw new Error('LiveKit env chưa cấu hình');
    }
    this.egressClient = new EgressClient(url, apiKey, apiSecret);
    return this.egressClient;
  }

  private buildR2Upload(): S3Upload {
    const accessKey = process.env.R2_ACCESS_KEY_ID;
    const secret = process.env.R2_SECRET_ACCESS_KEY;
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET_NAME ?? 'cogniva-recordings';
    if (!accessKey || !secret || !accountId) {
      throw new Error(
        'R2 env chưa đủ — cần R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ACCOUNT_ID',
      );
    }
    return new S3Upload({
      accessKey,
      secret,
      region: 'auto',
      bucket,
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
    });
  }

  private async assertMod(roomId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.room_member.findUnique({
      where: { room_id_user_id: { room_id: roomId, user_id: userId } },
      select: { role: true, status: true },
    });
    return m?.status === 'ACTIVE' && (m.role === 'OWNER' || m.role === 'MODERATOR');
  }

  async startRecording(user: AuthUser, roomId: string) {
    if (!(await this.assertMod(roomId, user.id))) {
      throw new ForbiddenException({ error: 'Chỉ mod/owner mới được record buổi học' });
    }

    const roomRow = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { status: true, features: true, name: true },
    });
    if (!roomRow) {
      throw new NotFoundException({ error: 'Room not found' });
    }
    const features = (roomRow.features as Record<string, boolean>) ?? {};
    if (features.recording === false) {
      throw new ForbiddenException({ error: 'Recording đã bị tắt trong phòng này (settings)' });
    }
    if (roomRow.status !== 'ACTIVE') {
      throw new BadRequestException({
        error: `Không thể record khi room đang ${roomRow.status}`,
      });
    }

    const existing = await this.prisma.recording.findFirst({
      where: { room_id: roomId, status: 'RECORDING' },
      select: { id: true },
    });
    if (existing) {
      throw new HttpException(
        { error: 'Đã có recording đang chạy', recordingId: existing.id },
        409,
      );
    }

    const filepath = `recordings/${roomId}/${Date.now()}.mp4`;
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath,
      output: { case: 's3', value: this.buildR2Upload() },
    });

    let info;
    try {
      info = await this.getEgressClient().startRoomCompositeEgress(roomId, output, 'speaker');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[record] start egress fail room=${roomId}: ${msg}`);
      throw new HttpException({ error: `Egress start fail: ${msg}` }, 500);
    }

    const rec = await this.prisma.recording.create({
      data: {
        id: randomUUID(),
        room_id: roomId,
        egress_id: info.egressId,
        status: 'RECORDING',
      },
    });

    await triggerEvent(`presence-room-${roomId}`, 'recording:started', {
      recordingId: rec.id,
      egressId: info.egressId,
      byUserId: user.id,
      byUserName: user.name,
    });

    return {
      ok: true,
      recordingId: rec.id,
      egressId: info.egressId,
    };
  }

  async listRecordings(uid: string, roomId: string) {
    const m = await this.prisma.room_member.findUnique({
      where: { room_id_user_id: { room_id: roomId, user_id: uid } },
    });
    if (!m || m.status !== 'ACTIVE') {
      throw new ForbiddenException({ error: 'Not a member' });
    }

    const rows = await this.prisma.recording.findMany({
      where: { room_id: roomId },
      orderBy: { started_at: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        duration_seconds: true,
        file_url: true,
        summary: true,
        started_at: true,
        ended_at: true,
      },
    });

    return {
      recordings: rows.map((r) => ({
        id: r.id,
        status: r.status,
        duration: r.duration_seconds,
        fileUrl: r.file_url,
        summary: r.summary,
        startedAt: r.started_at,
        endedAt: r.ended_at,
      })),
    };
  }

  async stopRecording(user: AuthUser, roomId: string, recordingId: string) {
    const m = await this.prisma.room_member.findUnique({
      where: { room_id_user_id: { room_id: roomId, user_id: user.id } },
      select: { role: true, status: true },
    });
    if (!m || m.status !== 'ACTIVE' || (m.role !== 'OWNER' && m.role !== 'MODERATOR')) {
      throw new ForbiddenException({ error: 'Chỉ mod/owner mới được stop record' });
    }

    const rec = await this.prisma.recording.findFirst({
      where: { id: recordingId, room_id: roomId },
      select: { egress_id: true, status: true },
    });
    if (!rec) throw new NotFoundException({ error: 'Recording not found' });
    if (!rec.egress_id) {
      throw new BadRequestException({
        error: 'Recording không có egressId — không stop được',
      });
    }
    if (rec.status !== 'RECORDING') {
      return { ok: true, alreadyStopped: true };
    }

    try {
      await this.getEgressClient().stopEgress(rec.egress_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not.found|404/i.test(msg)) {
        this.logger.error(`[record/stop] egressId=${rec.egress_id}: ${msg}`);
        throw new HttpException({ error: `Egress stop fail: ${msg}` }, 500);
      }
    }

    await this.prisma.recording.updateMany({
      where: { id: recordingId },
      data: { status: 'PROCESSING', ended_at: new Date() },
    });

    await triggerEvent(`presence-room-${roomId}`, 'recording:stopped', {
      recordingId,
      byUserId: user.id,
      byUserName: user.name,
    });

    return { ok: true };
  }
}
