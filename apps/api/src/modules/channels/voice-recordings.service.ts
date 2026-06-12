import { randomUUID } from 'node:crypto';

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  EgressClient,
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
} from 'livekit-server-sdk';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';
import { PermissionsService, type GroupRole } from '../groups/permissions.service';
import type { AuthUser } from '../../common/auth/session.types';
import { RecordingPipelineService } from './recording-pipeline.service';

function buildR2PublicUrl(filename: string): string {
  if (!filename) return '';
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (publicUrl) {
    return `${publicUrl.replace(/\/+$/, '')}/${filename.replace(/^\/+/, '')}`;
  }
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME ?? 'cogniva-recordings';
  if (!accountId) return filename;
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${filename}`;
}

function resolveEgressFileUrl(input: {
  filename?: string | null;
  location?: string | null;
}): string | null {
  if (input.filename) return buildR2PublicUrl(input.filename);
  if (input.location) return input.location;
  return null;
}

@Injectable()
export class VoiceRecordingsService {
  private egress: EgressClient | null = null;
  private s3: S3Client | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly pipeline: RecordingPipelineService,
  ) {}

  private egressClient(missingEnvMsg: string): EgressClient {
    if (this.egress) return this.egress;
    const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) throw new Error(missingEnvMsg);
    this.egress = new EgressClient(url, apiKey, apiSecret);
    return this.egress;
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

  private async deleteR2Object(storageKey: string): Promise<void> {
    if (!this.s3) {
      const accessKey = process.env.R2_ACCESS_KEY_ID;
      const secret = process.env.R2_SECRET_ACCESS_KEY;
      const accountId = process.env.R2_ACCOUNT_ID;
      if (!accessKey || !secret || !accountId) {
        throw new Error(
          'R2 env chưa đủ — cần R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ACCOUNT_ID',
        );
      }
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: accessKey, secretAccessKey: secret },
        forcePathStyle: true,
      });
    }
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME ?? 'cogniva-recordings',
        Key: storageKey,
      }),
    );
  }

  private async loadContext(channelId: string, userId: string) {
    const channel = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) return null;
    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: channel.group_id, user_id: userId } },
    });
    if (!member) return null;
    return { channel, member };
  }

  private async requireRecordMod(channelId: string, userId: string, denyMsg: string) {
    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true },
    });
    if (!ch) throw new NotFoundException({ error: 'Channel not found' });

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: userId } },
      select: { role: true },
    });
    if (!member || !this.permissions.can(member.role as GroupRole, 'voice.record')) {
      throw new ForbiddenException({ error: denyMsg });
    }
  }

  async startRecording(user: AuthUser, channelId: string) {
    const ctx = await this.loadContext(channelId, user.id);
    if (!ctx) throw new ForbiddenException({ error: 'Forbidden' });
    const { channel, member } = ctx;

    if (channel.type !== 'VOICE') {
      throw new BadRequestException({ error: 'Chỉ VOICE channel mới record được' });
    }
    if (!this.permissions.can(member.role as GroupRole, 'voice.record')) {
      throw new ForbiddenException({
        error: 'Chỉ mod/admin/owner mới được record voice channel',
      });
    }
    if (!channel.livekit_room_name) {
      throw new BadRequestException({
        error: 'Channel chưa có LiveKit room — yêu cầu user vào voice trước',
      });
    }

    const existing = await this.prisma.recording.findFirst({
      where: { study_group_channel_id: channelId, status: 'RECORDING' },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        error: 'Đã có recording đang chạy',
        recordingId: existing.id,
      });
    }

    let output: EncodedFileOutput;
    const storageKey = `recordings/group/${channelId}/${Date.now()}.mp4`;
    try {
      output = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath: storageKey,
        output: { case: 's3', value: this.buildR2Upload() },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException({
        error:
          'Cloud storage (R2) chưa cấu hình — cần set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME trong .env.local. Chi tiết: ' +
          msg,
      });
    }

    let info;
    try {
      info = await this.egressClient('LiveKit env chưa cấu hình').startRoomCompositeEgress(
        channel.livekit_room_name,
        output,
        'speaker',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[channel/record] start egress fail channel=${channelId}:`, msg);
      throw new InternalServerErrorException({ error: `Egress start fail: ${msg}` });
    }

    const rec = await this.prisma.recording.create({
      data: {
        id: randomUUID(),
        study_group_channel_id: channelId,
        egress_id: info.egressId,
        storage_key: storageKey,
        status: 'RECORDING',
        created_by: user.id,
      },
    });

    await triggerEvent(`presence-voice-${channelId}`, 'recording:started', {
      recordingId: rec.id,
      egressId: info.egressId,
      byUserId: user.id,
      byUserName: user.name,
    });

    return { ok: true, recordingId: rec.id, egressId: info.egressId };
  }

  async listRecordings(userId: string, channelId: string) {
    const ctx = await this.loadContext(channelId, userId);
    if (!ctx) throw new ForbiddenException({ error: 'Forbidden' });

    const rows = await this.prisma.recording.findMany({
      where: { study_group_channel_id: channelId, egress_id: { not: null } },
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
        created_by: true,
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
        createdBy: r.created_by,
      })),
    };
  }

  async getRecordingDetail(userId: string, recId: string) {
    const rec = await this.prisma.recording.findUnique({ where: { id: recId } });
    if (!rec || !rec.study_group_channel_id) throw new NotFoundException({ error: 'Not found' });

    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: rec.study_group_channel_id },
      select: { group_id: true, name: true },
    });
    if (!ch) throw new NotFoundException({ error: 'Not found' });

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: userId } },
      select: { role: true },
    });
    if (!member) throw new NotFoundException({ error: 'Not found' });

    const group = await this.prisma.study_group.findUnique({
      where: { id: ch.group_id },
      select: { name: true },
    });

    return {
      recording: {
        id: rec.id,
        status: rec.status,
        fileUrl: rec.file_url,
        duration: rec.duration_seconds,
        summary: rec.summary,
        transcript: rec.transcript,
        chapters: rec.chapters,
        startedAt: rec.started_at,
        endedAt: rec.ended_at,
      },
      channel: { id: rec.study_group_channel_id, groupId: ch.group_id, name: ch.name },
      groupName: group?.name ?? null,
      canDelete: ['OWNER', 'ADMIN', 'MODERATOR'].includes(member.role),
    };
  }

  async deleteRecording(channelId: string, recordingId: string, userId: string) {
    await this.requireRecordMod(channelId, userId, 'Chỉ mod/admin/owner mới được xoá recording');

    const rec = await this.prisma.recording.findFirst({
      where: { id: recordingId, study_group_channel_id: channelId },
      select: { id: true, status: true, storage_key: true },
    });
    if (!rec) throw new NotFoundException({ error: 'Recording not found' });

    if (rec.status === 'RECORDING') {
      throw new ConflictException({ error: 'Đang ghi — bấm dừng trước khi xoá' });
    }

    if (rec.storage_key) {
      try {
        await this.deleteR2Object(rec.storage_key);
      } catch (err) {
        console.error('[record/delete] R2 delete fail:', err);
      }
    }

    await this.prisma.recording.delete({ where: { id: recordingId } });

    await triggerEvent(`presence-voice-${channelId}`, 'recording:deleted', { recordingId });

    return { ok: true };
  }

  async stopRecording(user: AuthUser, channelId: string, recordingId: string) {
    await this.requireRecordMod(channelId, user.id, 'Chỉ mod/admin/owner mới được stop record');

    const rec = await this.prisma.recording.findFirst({
      where: { id: recordingId, study_group_channel_id: channelId },
      select: { egress_id: true, status: true },
    });
    if (!rec) throw new NotFoundException({ error: 'Recording not found' });
    if (!rec.egress_id) {
      throw new BadRequestException({ error: 'Recording không có egressId — không stop được' });
    }
    if (rec.status !== 'RECORDING') {
      return { ok: true, alreadyStopped: true };
    }

    try {
      await this.egressClient('LiveKit env missing').stopEgress(rec.egress_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not.found|404/i.test(msg)) {
        console.error(`[channel/record/stop] egressId=${rec.egress_id}:`, msg);
        throw new InternalServerErrorException({ error: `Egress stop fail: ${msg}` });
      }
    }

    await this.prisma.recording.update({
      where: { id: recordingId },
      data: { status: 'PROCESSING', ended_at: new Date() },
    });

    await triggerEvent(`presence-voice-${channelId}`, 'recording:stopped', {
      recordingId,
      byUserId: user.id,
      byUserName: user.name,
    });

    return { ok: true };
  }

  async syncRecording(user: AuthUser, channelId: string, recordingId: string, force: boolean) {
    await this.requireRecordMod(channelId, user.id, 'Forbidden');

    const rec = await this.prisma.recording.findFirst({
      where: { id: recordingId, study_group_channel_id: channelId },
    });
    if (!rec) throw new NotFoundException({ error: 'Recording not found' });
    if (!rec.egress_id) {
      throw new BadRequestException({ error: 'Recording không có egressId — không sync được' });
    }
    if ((rec.status === 'PROCESSED' || rec.status === 'FAILED') && !force) {
      return { status: rec.status, alreadyDone: true };
    }

    let egressList;
    try {
      egressList = await this.egressClient('LiveKit env missing').listEgress({
        egressId: rec.egress_id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[sync] listEgress fail:', msg);
      throw new BadGatewayException({ error: 'LiveKit query fail: ' + msg });
    }
    const info = egressList?.[0];
    if (!info) {
      throw new NotFoundException({
        error: 'Egress không tồn tại trên LiveKit (có thể đã quá 24h)',
      });
    }

    const lkStatus = info.status;
    let newDbStatus = rec.status as 'RECORDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
    let fileUrl: string | null = rec.file_url;
    let fileSize: number | null = rec.file_size_bytes;
    let duration: number | null = rec.duration_seconds;

    if (lkStatus === EgressStatus.EGRESS_COMPLETE) {
      const fileResult = info.fileResults?.[0];
      fileUrl = rec.storage_key
        ? buildR2PublicUrl(rec.storage_key)
        : resolveEgressFileUrl({
            filename: fileResult?.filename,
            location: fileResult?.location,
          });
      fileSize = fileResult?.size ? Number(fileResult.size) : null;
      duration =
        info.endedAt && info.startedAt
          ? Math.round((Number(info.endedAt) - Number(info.startedAt)) / 1_000_000_000)
          : null;
      newDbStatus = fileUrl ? 'PROCESSING' : 'FAILED';
    } else if (
      lkStatus === EgressStatus.EGRESS_FAILED ||
      lkStatus === EgressStatus.EGRESS_ABORTED
    ) {
      newDbStatus = 'FAILED';
    } else if (
      lkStatus === EgressStatus.EGRESS_ACTIVE ||
      lkStatus === EgressStatus.EGRESS_STARTING
    ) {
      return {
        status: rec.status,
        egressStatus: lkStatus,
        message: 'Egress vẫn đang chạy trên LiveKit — thử lại sau vài giây',
      };
    } else if (lkStatus === EgressStatus.EGRESS_ENDING) {
      return {
        status: rec.status,
        egressStatus: lkStatus,
        message: 'Egress đang flush file lên R2 — thử lại sau vài giây',
      };
    }

    await this.prisma.recording.update({
      where: { id: recordingId },
      data: {
        status: newDbStatus,
        file_url: fileUrl,
        file_size_bytes: fileSize,
        duration_seconds: duration,
        ended_at: rec.ended_at ?? new Date(),
      },
    });

    if (newDbStatus === 'PROCESSING' && fileUrl) {
      await triggerEvent(`presence-voice-${channelId}`, 'recording:ended', {
        recordingId: rec.id,
        fileUrl,
      });
      const pipelineResult = await this.pipeline.run({
        recordingId: rec.id,
        fileUrl,
        channelId,
        durationHint: duration ?? undefined,
      });
      return {
        status: pipelineResult.ok ? 'PROCESSED' : 'FAILED',
        egressStatus: lkStatus,
        fileUrl,
        duration,
        transcriptLength: pipelineResult.transcriptLength,
        chapterCount: pipelineResult.chapterCount,
        ...(pipelineResult.error ? { pipelineError: pipelineResult.error } : {}),
      };
    }

    return { status: newDbStatus, egressStatus: lkStatus, fileUrl, duration };
  }
}
