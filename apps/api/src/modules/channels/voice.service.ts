import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ParticipantPermission } from 'livekit-server-sdk';
import { SignJWT } from 'jose';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';
import { LivekitService } from '../../infra/livekit/livekit.service';
import { PermissionsService, type GroupRole } from '../groups/permissions.service';
import type { AuthUser } from '../../common/auth/session.types';
import {
  collabTokenSchema,
  stageActionSchema,
  type VoiceStateInput,
} from './dto/channels-voice.dto';

const MOD_ROLES = ['OWNER', 'ADMIN', 'MODERATOR'];

@Injectable()
export class VoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LivekitService,
    private readonly permissions: PermissionsService,
  ) {}

  async joinVoice(user: AuthUser, channelId: string) {
    const channel = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { id: true, group_id: true, type: true },
    });
    if (!channel) throw new NotFoundException({ error: 'Channel not found' });
    if (channel.type !== 'VOICE' && channel.type !== 'STAGE') {
      throw new BadRequestException({ error: 'Channel không phải VOICE/STAGE' });
    }

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: channel.group_id, user_id: user.id } },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException({ error: 'Not a member' });

    await this.prisma.study_group_voice_state.upsert({
      where: { user_id: user.id },
      create: { user_id: user.id, channel_id: channelId, self_muted: true },
      update: {
        channel_id: channelId,
        joined_at: new Date(),
        self_muted: true,
        server_muted: false,
        camera: false,
        screen_share: false,
      },
    });

    void triggerEvent(`presence-voice-${channelId}`, 'voice:join', {
      userId: user.id,
      name: user.name ?? '',
      image: user.image ?? null,
      selfMuted: true,
      serverMuted: false,
      camera: false,
      screenShare: false,
      joinedAt: new Date().toISOString(),
    });

    return { ok: true };
  }

  async leaveVoice(userId: string, channelId: string) {
    await this.prisma.study_group_voice_state.deleteMany({
      where: { user_id: userId, channel_id: channelId },
    });

    void triggerEvent(`presence-voice-${channelId}`, 'voice:leave', { userId });

    return { ok: true };
  }

  async syncVoiceState(userId: string, channelId: string, delta: VoiceStateInput) {
    if (Object.keys(delta).length === 0) {
      return { ok: true, noop: true };
    }

    const update: Prisma.study_group_voice_stateUncheckedUpdateInput = {
      channel_id: channelId,
    };
    if (delta.selfMuted !== undefined) update.self_muted = delta.selfMuted;
    if (delta.camera !== undefined) update.camera = delta.camera;
    if (delta.screenShare !== undefined) update.screen_share = delta.screenShare;

    await this.prisma.study_group_voice_state.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        channel_id: channelId,
        self_muted: delta.selfMuted ?? false,
        camera: delta.camera ?? false,
        screen_share: delta.screenShare ?? false,
      },
      update,
    });

    void triggerEvent(`presence-voice-${channelId}`, 'voice:state-changed', {
      userId,
      ...delta,
    });

    return { ok: true };
  }

  async issueVoiceToken(user: AuthUser, channelId: string) {
    const channel = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) throw new NotFoundException({ error: 'Channel không tồn tại' });
    if (channel.type !== 'VOICE' && channel.type !== 'STAGE') {
      throw new BadRequestException({ error: 'Channel không phải VOICE/STAGE' });
    }

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: channel.group_id, user_id: user.id } },
    });
    if (!member) throw new ForbiddenException({ error: 'Forbidden' });
    if (!this.permissions.can(member.role as GroupRole, 'voice.connect')) {
      throw new ForbiddenException({ error: 'Không có quyền join voice' });
    }
    if (this.permissions.isMuted(member)) {
      throw new ForbiddenException({ error: 'Bạn đang bị mute' });
    }

    let livekitRoomName = channel.livekit_room_name;
    if (!livekitRoomName) {
      livekitRoomName = `group:${channel.id}`;
      await this.prisma.study_group_channel.update({
        where: { id: channel.id },
        data: { livekit_room_name: livekitRoomName },
      });
    }

    const isMod = MOD_ROLES.includes(member.role);
    const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    if (!url) {
      throw new InternalServerErrorException({ error: 'LiveKit chưa cấu hình' });
    }

    let canPublish = true;
    let stageRole: 'AUDIENCE' | 'SPEAKER' | null = null;
    if (channel.type === 'STAGE') {
      if (isMod) {
        canPublish = true;
        stageRole = 'SPEAKER';
      } else {
        const existing = await this.prisma.study_group_stage_role.findUnique({
          where: { user_id_channel_id: { user_id: user.id, channel_id: channel.id } },
          select: { role: true },
        });
        if (!existing) {
          await this.prisma.study_group_stage_role.createMany({
            data: [{ channel_id: channel.id, user_id: user.id, role: 'AUDIENCE' }],
            skipDuplicates: true,
          });
          stageRole = 'AUDIENCE';
          canPublish = false;
        } else {
          stageRole = existing.role as 'AUDIENCE' | 'SPEAKER';
          canPublish = stageRole === 'SPEAKER';
        }
      }
    }

    try {
      const token = await this.livekit.createLivekitToken({
        identity: user.id,
        roomName: livekitRoomName,
        name: member.nickname ?? user.name ?? 'Unknown',
        isMod,
        canPublish,
        ttl: '4h',
        metadata: {
          groupRole: member.role,
          stageRole,
          avatar: user.image ?? null,
        },
      });
      return {
        token,
        url,
        channel: { id: channel.id, name: channel.name, livekitRoomName, type: channel.type },
        isMod,
        stageRole,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[voice/token] sign fail:', msg);
      throw new InternalServerErrorException({ error: 'Token gen thất bại' });
    }
  }

  async listParticipants(userId: string, channelId: string) {
    const channel = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true },
    });
    if (!channel) throw new NotFoundException({ error: 'Channel không tồn tại' });

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: channel.group_id, user_id: userId } },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException({ error: 'Forbidden' });

    const rows = await this.prisma.study_group_voice_state.findMany({
      where: { channel_id: channelId },
      include: { user: { select: { name: true, image: true } } },
    });

    return {
      participants: rows.map((r) => ({
        userId: r.user_id,
        name: r.user.name,
        image: r.user.image,
        selfMuted: r.self_muted,
        serverMuted: r.server_muted,
        camera: r.camera,
        screenShare: r.screen_share,
        joinedAt: r.joined_at,
      })),
    };
  }

  private async loadStageCtx(channelId: string, userId: string) {
    const channel = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
    });
    if (!channel || channel.type !== 'STAGE') return null;
    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: channel.group_id, user_id: userId } },
      select: { role: true },
    });
    if (!member) return null;
    return { channel, member };
  }

  async getStageState(user: AuthUser, channelId: string) {
    const ctx = await this.loadStageCtx(channelId, user.id);
    if (!ctx) throw new ForbiddenException({ error: 'Forbidden' });

    const speakers = await this.prisma.study_group_stage_role.findMany({
      where: { channel_id: channelId, role: 'SPEAKER' },
      include: { user: { select: { name: true, image: true } } },
    });

    const raised = await this.prisma.study_group_stage_role.findMany({
      where: { channel_id: channelId, role: 'AUDIENCE', raised_at: { not: null } },
      include: { user: { select: { name: true, image: true } } },
      orderBy: { raised_at: 'asc' },
    });

    const isMod = MOD_ROLES.includes(ctx.member.role);
    const mine = await this.prisma.study_group_stage_role.findUnique({
      where: { user_id_channel_id: { user_id: user.id, channel_id: channelId } },
      select: { role: true, raised_at: true },
    });

    return {
      mySelf: {
        role: isMod ? 'MOD' : (mine?.role ?? 'AUDIENCE'),
        raised: !!mine?.raised_at,
      },
      speakers: speakers.map((s) => ({
        userId: s.user_id,
        name: s.user.name,
        image: s.user.image,
        promotedAt: s.promoted_at?.toISOString() ?? null,
      })),
      raisedHands: raised.map((r) => ({
        userId: r.user_id,
        name: r.user.name,
        image: r.user.image,
        raisedAt: r.raised_at?.toISOString() ?? '',
      })),
      isMod,
    };
  }

  async raiseHand(user: AuthUser, channelId: string, raw: unknown) {
    const ctx = await this.loadStageCtx(channelId, user.id);
    if (!ctx) throw new ForbiddenException({ error: 'Forbidden' });

    const parsed = stageActionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }

    if (MOD_ROLES.includes(ctx.member.role)) {
      throw new BadRequestException({ error: 'Mod không cần raise hand' });
    }

    const raisedAt = parsed.data.action === 'raise' ? new Date() : null;
    await this.prisma.study_group_stage_role.upsert({
      where: { user_id_channel_id: { user_id: user.id, channel_id: channelId } },
      create: { channel_id: channelId, user_id: user.id, role: 'AUDIENCE', raised_at: raisedAt },
      update: { raised_at: raisedAt },
    });

    await triggerEvent(`presence-voice-${channelId}`, 'stage:hand', {
      userId: user.id,
      userName: user.name,
      raised: parsed.data.action === 'raise',
    });

    return { ok: true, raised: parsed.data.action === 'raise' };
  }

  async promoteSpeaker(user: AuthUser, channelId: string, targetUserId: string) {
    const ch = await this.prisma.study_group_channel.findUnique({ where: { id: channelId } });
    if (!ch || ch.type !== 'STAGE') {
      throw new NotFoundException({ error: 'Stage channel không tồn tại' });
    }

    const me = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: user.id } },
      select: { role: true },
    });
    if (!me || !MOD_ROLES.includes(me.role)) {
      throw new ForbiddenException({ error: 'Chỉ mod được promote' });
    }

    const target = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: targetUserId } },
      select: { id: true },
    });
    if (!target) {
      throw new BadRequestException({ error: 'User không phải member group' });
    }

    await this.prisma.study_group_stage_role.upsert({
      where: { user_id_channel_id: { user_id: targetUserId, channel_id: channelId } },
      create: {
        channel_id: channelId,
        user_id: targetUserId,
        role: 'SPEAKER',
        raised_at: null,
        promoted_at: new Date(),
      },
      update: { role: 'SPEAKER', raised_at: null, promoted_at: new Date() },
    });

    if (ch.livekit_room_name) {
      try {
        await this.livekit.getRoomService().updateParticipant(
          ch.livekit_room_name,
          targetUserId,
          undefined,
          new ParticipantPermission({
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
          }),
        );
      } catch (err) {
        console.warn('[stage/promote] LiveKit update fail (user offline?):', err);
      }
    }

    await triggerEvent(`presence-voice-${channelId}`, 'stage:promoted', {
      userId: targetUserId,
      byUserId: user.id,
    });

    return { ok: true };
  }

  async demoteSpeaker(user: AuthUser, channelId: string, targetUserId: string) {
    const ch = await this.prisma.study_group_channel.findUnique({ where: { id: channelId } });
    if (!ch || ch.type !== 'STAGE') {
      throw new NotFoundException({ error: 'Stage channel không tồn tại' });
    }

    const me = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: user.id } },
      select: { role: true },
    });
    if (!me) throw new ForbiddenException({ error: 'Forbidden' });

    const isSelf = targetUserId === user.id;
    const isMod = MOD_ROLES.includes(me.role);
    if (!isSelf && !isMod) {
      throw new ForbiddenException({ error: 'Chỉ mod được demote người khác' });
    }

    await this.prisma.study_group_stage_role.upsert({
      where: { user_id_channel_id: { user_id: targetUserId, channel_id: channelId } },
      create: {
        channel_id: channelId,
        user_id: targetUserId,
        role: 'AUDIENCE',
        raised_at: null,
        promoted_at: null,
      },
      update: { role: 'AUDIENCE', raised_at: null, promoted_at: null },
    });

    if (ch.livekit_room_name) {
      try {
        await this.livekit.getRoomService().updateParticipant(
          ch.livekit_room_name,
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
      byUserId: user.id,
    });

    return { ok: true };
  }

  async issueCollabToken(userId: string, channelId: string, raw: unknown) {
    const parsed = collabTokenSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'Invalid body' });
    }

    const channel = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { id: true, group_id: true },
    });
    if (!channel) throw new NotFoundException({ error: 'Channel không tồn tại' });

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: channel.group_id, user_id: userId } },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException({ error: 'Not a group member' });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new InternalServerErrorException({ error: 'JWT_SECRET not configured' });
    }
    if (secret.length < 32) {
      throw new InternalServerErrorException({ error: 'JWT_SECRET too short (need 32+)' });
    }

    const url = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
    if (!url) {
      throw new InternalServerErrorException({ error: 'NEXT_PUBLIC_HOCUSPOCUS_URL not set' });
    }

    const token = await new SignJWT({ userId, roomId: channelId, kind: parsed.data.kind })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(secret));

    return { token, url };
  }
}
