/**
 * RoomsService — port từ apps/web/src/app/api/rooms/{route,join,[id]/{route,
 * token,collab-token,moderate}}.ts. Wire-shape giữ nguyên route cũ: key order
 * theo Drizzle (room.mappers), message lỗi tiếng Việt nguyên văn, cache
 * key/TTL + invalidator (onRoomChanged) y từng call.
 */
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SignJWT } from 'jose';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import { onRoomChanged } from '@cogniva/server-core/cache/invalidate';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';
import { LivekitService } from '../../infra/livekit/livekit.service';
import type { AuthUser } from '../../common/auth/session.types';
import { generateJoinCode, toRoomDto } from './room.mappers';
import {
  collabTokenSchema,
  joinRoomSchema,
  type CreateRoomInput,
  type ModerateInput,
  type RoomTokenInput,
} from './dto/rooms.dto';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LivekitService,
  ) {}

  /** Membership của user trong room (mọi status) — dùng chung cho các check quyền. */
  findMembership(roomId: string, userId: string) {
    return this.prisma.room_member.findUnique({
      where: { room_id_user_id: { room_id: roomId, user_id: userId } },
    });
  }

  /** Member ACTIVE? — guard chat/recordings (route cũ query where status='ACTIVE'). */
  async isActiveMember(roomId: string, userId: string): Promise<boolean> {
    const m = await this.findMembership(roomId, userId);
    return m?.status === 'ACTIVE';
  }

  /**
   * GET /rooms — cache-aside TTL 60s (key ck.roomsList y route cũ), invalidate
   * qua onRoomChanged tại create/join/delete/moderate. Route cũ count member
   * bằng subquery ::int — ở đây groupBy ACTIVE trên union id (cùng kết quả).
   */
  async listRooms(uid: string) {
    const { mine, joined } = await cached(ck.roomsList(uid), 60, async () => {
      const mineRows = await this.prisma.room.findMany({
        where: { owner_id: uid },
        orderBy: { created_at: 'desc' },
        take: 50,
      });

      const joinedRows = await this.prisma.room_member.findMany({
        where: { user_id: uid, status: 'ACTIVE', room: { owner_id: { not: uid } } },
        orderBy: { room: { created_at: 'desc' } },
        take: 50,
        select: { role: true, room: true },
      });

      const ids = [...mineRows.map((r) => r.id), ...joinedRows.map((j) => j.room.id)];
      const counts = ids.length
        ? await this.prisma.room_member.groupBy({
            by: ['room_id'],
            where: { room_id: { in: ids }, status: 'ACTIVE' },
            _count: { _all: true },
          })
        : [];
      const countMap = new Map(counts.map((c) => [c.room_id, c._count._all]));

      return {
        mine: mineRows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          type: r.type,
          visibility: r.visibility,
          status: r.status,
          joinCode: r.join_code,
          createdAt: r.created_at,
          memberCount: countMap.get(r.id) ?? 0,
        })),
        joined: joinedRows.map((j) => ({
          id: j.room.id,
          name: j.room.name,
          description: j.room.description,
          type: j.room.type,
          visibility: j.room.visibility,
          status: j.room.status,
          role: j.role,
          createdAt: j.room.created_at,
          memberCount: countMap.get(j.room.id) ?? 0,
        })),
      };
    });

    return { mine, joined };
  }

  /** POST /rooms — tạo room + owner member (tx), retry 3 lần nếu joinCode collision. */
  async createRoom(uid: string, input: CreateRoomInput) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const joinCode = generateJoinCode();
          const created = await tx.room.create({
            data: {
              id: randomUUID(),
              owner_id: uid,
              name: input.name,
              description: input.description,
              type: input.type,
              visibility: input.visibility,
              max_members: input.maxMembers,
              join_code: joinCode,
            },
          });
          await tx.room_member.create({
            data: {
              id: randomUUID(),
              room_id: created.id,
              user_id: uid,
              role: 'OWNER',
              status: 'ACTIVE',
            },
          });
          return created;
        });

        // livekitRoomName = room.id (convention) — set sau insert vì cần id
        await this.prisma.room.update({
          where: { id: result.id },
          data: { livekit_room_name: result.id },
        });

        await onRoomChanged(uid);

        return { room: { ...toRoomDto(result), livekitRoomName: result.id } };
      } catch (err) {
        // Route cũ match message '23505'+'join_code' của postgres.js; Prisma báo
        // unique violation qua P2002 (meta.target chứa join_code) — cùng retry.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          JSON.stringify(err.meta ?? {}).includes('join_code')
        ) {
          continue;
        }
        throw err;
      }
    }

    throw new InternalServerErrorException({ error: 'Không tạo được joinCode unique' });
  }

  /** GET /rooms/:id — PRIVATE + không phải member → 404 (anti-enumeration). */
  async getRoom(uid: string, id: string) {
    const target = await this.prisma.room.findUnique({ where: { id } });
    if (!target) throw new NotFoundException({ error: 'Not found' });

    const memberRows = await this.prisma.room_member.findMany({
      where: { room_id: id, status: 'ACTIVE' },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    });
    const members = memberRows.map((m) => ({
      id: m.id,
      userId: m.user_id,
      role: m.role,
      status: m.status,
      joinedAt: m.joined_at,
      lastSeenAt: m.last_seen_at,
      user: { id: m.user.id, name: m.user.name, email: m.user.email, image: m.user.image },
    }));

    const isOwner = target.owner_id === uid;
    const myMembership = members.find((m) => m.userId === uid);
    const canSeeMembers = isOwner || myMembership !== undefined;

    if (!canSeeMembers && target.visibility === 'PRIVATE') {
      throw new NotFoundException({ error: 'Not found' });
    }

    return {
      room: {
        ...toRoomDto(target),
        // undefined → JSON.stringify drop key, y route cũ khi không có quyền xem
        members: canSeeMembers ? members : undefined,
        myRole: myMembership?.role ?? (isOwner ? 'OWNER' : null),
      },
    };
  }

  /** DELETE /rooms/:id — chỉ owner; cascade member/message/recording theo FK. */
  async deleteRoom(uid: string, id: string) {
    const target = await this.prisma.room.findUnique({ where: { id } });
    if (!target) throw new NotFoundException({ error: 'Not found' });
    if (target.owner_id !== uid) throw new ForbiddenException({ error: 'Forbidden' });

    await this.prisma.room.deleteMany({ where: { id, owner_id: uid } });
    await onRoomChanged(uid);

    return { ok: true };
  }

  /** POST /rooms/join — join qua 6-char code. Parse body trong service (400 'Invalid body'). */
  async joinByCode(uid: string, raw: unknown) {
    const parsed = joinRoomSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: 'Invalid body' });

    const target = await this.prisma.room.findUnique({
      where: { join_code: parsed.data.code.toUpperCase() },
    });
    if (!target) throw new NotFoundException({ error: 'Mã không hợp lệ' });

    const existing = await this.findMembership(target.id, uid);
    if (existing?.status === 'BANNED' || existing?.status === 'KICKED') {
      throw new ForbiddenException({ error: 'Bạn không thể vào phòng này' });
    }

    if (!existing) {
      await this.prisma.room_member.create({
        data: {
          id: randomUUID(),
          room_id: target.id,
          user_id: uid,
          role: target.owner_id === uid ? 'OWNER' : 'MEMBER',
          status: 'ACTIVE',
        },
      });
      await onRoomChanged(uid);
    } else if (existing.status !== 'ACTIVE') {
      await this.prisma.room_member.updateMany({
        where: { room_id: target.id, user_id: uid },
        data: { status: 'ACTIVE' },
      });
      await onRoomChanged(uid);
    }

    return { roomId: target.id };
  }

  /**
   * POST /rooms/:id/token — issue LiveKit JWT. Capacity check fail-open
   * (LiveKit unreachable → vẫn cho join, y route cũ).
   */
  async issueToken(user: AuthUser, roomId: string, input: RoomTokenInput) {
    const target = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!target) throw new NotFoundException({ error: 'Not found' });

    const uid = user.id;
    const isOwner = target.owner_id === uid;

    const existing = await this.findMembership(roomId, uid);
    if (existing && (existing.status === 'BANNED' || existing.status === 'KICKED')) {
      throw new ForbiddenException({
        error: existing.status === 'BANNED' ? 'Bạn đã bị ban khỏi phòng' : 'Bạn đã bị kick',
      });
    }

    if (!existing) {
      if (target.visibility === 'PRIVATE' && !isOwner) {
        throw new ForbiddenException({ error: 'Phòng riêng tư, cần được mời' });
      }
      await this.prisma.room_member.create({
        data: {
          id: randomUUID(),
          room_id: roomId,
          user_id: uid,
          role: isOwner ? 'OWNER' : 'MEMBER',
          status: 'ACTIVE',
        },
      });
    }

    const myRole = existing?.role ?? (isOwner ? 'OWNER' : 'MEMBER');
    const isMod = myRole === 'OWNER' || myRole === 'MODERATOR';

    // Capacity check NGOÀI try-throw: route cũ chỉ swallow lỗi LiveKit call,
    // còn 403 "đủ người" vẫn trả bình thường.
    let active: number | null = null;
    try {
      active = await this.livekit.getActiveParticipantCount(target.livekit_room_name ?? roomId);
    } catch (err) {
      this.logger.error(`[rooms/token] LiveKit unreachable, skip capacity check: ${err}`);
    }
    if (active !== null && active >= target.max_members && !isMod) {
      throw new ForbiddenException({ error: `Phòng đã đủ ${target.max_members} người` });
    }

    const token = await this.livekit.createLivekitToken({
      identity: uid,
      name: input.displayName ?? user.name ?? user.email,
      roomName: target.livekit_room_name ?? roomId,
      isMod,
      ttl: '2h',
      metadata: {
        userId: uid,
        role: myRole,
        avatarUrl: user.image,
      },
    });

    await this.prisma.room_member.updateMany({
      where: { room_id: roomId, user_id: uid },
      data: { last_seen_at: new Date() },
    });

    return {
      token,
      serverUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL,
      roomName: target.livekit_room_name ?? roomId,
      role: myRole,
    };
  }

  /**
   * POST /rooms/:id/collab-token — JWT HS256 ký bằng JWT_SECRET cho Hocuspocus,
   * port AS-IS như channels (route cũ dùng jsonwebtoken — api dùng jose, cùng
   * output HS256 chuẩn iat + exp 15m, Hocuspocus verify interop bình thường).
   */
  async issueCollabToken(userId: string, roomId: string, raw: unknown) {
    const parsed = collabTokenSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: 'Invalid body' });

    if (!(await this.isActiveMember(roomId, userId))) {
      throw new ForbiddenException({ error: 'Not a member' });
    }

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

    const token = await new SignJWT({ userId, roomId, kind: parsed.data.kind })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(secret));

    return { token, url };
  }

  /**
   * POST /rooms/:id/moderate — mod actions. Permissions:
   * OWNER tất cả; MODERATOR trừ LOCK/PROMOTE/DEMOTE; MEMBER 403.
   * Action fail → 500 {error: message} y route cũ.
   */
  async moderate(uid: string, roomId: string, input: ModerateInput) {
    const callerMember = await this.findMembership(roomId, uid);
    const isOwner = callerMember?.role === 'OWNER';
    const isMod = callerMember?.role === 'MODERATOR' || isOwner;
    if (!isMod) throw new ForbiddenException({ error: 'Forbidden' });

    const ownerOnly = ['LOCK', 'PROMOTE', 'DEMOTE'];
    if (ownerOnly.includes(input.action) && !isOwner) {
      throw new ForbiddenException({ error: 'Chỉ owner được phép' });
    }

    const target = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!target) throw new NotFoundException({ error: 'Not found' });
    const lkRoom = target.livekit_room_name ?? roomId;

    try {
      switch (input.action) {
        case 'KICK': {
          const { targetUserId } = input;
          // 1. Disconnect khỏi LiveKit — participant có thể chưa join → bỏ qua
          try {
            await this.livekit.getRoomService().removeParticipant(lkRoom, targetUserId);
          } catch (err) {
            this.logger.warn(`[moderate/KICK] LiveKit removeParticipant fail: ${err}`);
          }
          await this.prisma.room_member.updateMany({
            where: { room_id: roomId, user_id: targetUserId },
            data: { status: 'KICKED' },
          });
          await triggerEvent(`presence-user-${targetUserId}`, 'room:kicked', { roomId });
          await onRoomChanged(targetUserId); // KICKED → room biến khỏi joined-list của target
          break;
        }

        case 'MUTE': {
          const { targetUserId } = input;
          try {
            const participants = await this.livekit.getRoomService().listParticipants(lkRoom);
            const p = participants.find((x) => x.identity === targetUserId);
            const audioTrack = p?.tracks.find((t) => t.source === 1 /* MICROPHONE */);
            if (audioTrack) {
              await this.livekit
                .getRoomService()
                .mutePublishedTrack(lkRoom, targetUserId, audioTrack.sid, true);
            }
          } catch (err) {
            this.logger.warn(`[moderate/MUTE] fail: ${err}`);
          }
          break;
        }

        case 'UNMUTE_REQUEST': {
          const { targetUserId } = input;
          // Chỉ gửi tín hiệu — LiveKit không force unmute được (privacy)
          await triggerEvent(`presence-user-${targetUserId}`, 'room:unmute-request', { roomId });
          break;
        }

        case 'LOCK': {
          const { locked } = input;
          await this.livekit.getRoomService().updateRoomMetadata(lkRoom, JSON.stringify({ locked }));
          await triggerEvent(`presence-room-${roomId}`, 'room:lock-changed', { locked });
          break;
        }

        case 'APPROVE': {
          const { targetUserId } = input;
          await this.prisma.room_member.updateMany({
            where: { room_id: roomId, user_id: targetUserId },
            data: { status: 'ACTIVE', joined_at: new Date() },
          });
          await triggerEvent(`presence-user-${targetUserId}`, 'room:approved', { roomId });
          await onRoomChanged(targetUserId); // PENDING→ACTIVE → room vào joined-list của target
          break;
        }

        case 'REJECT': {
          const { targetUserId } = input;
          await this.prisma.room_member.updateMany({
            where: { room_id: roomId, user_id: targetUserId },
            data: { status: 'BANNED' },
          });
          await triggerEvent(`presence-user-${targetUserId}`, 'room:rejected', { roomId });
          await onRoomChanged(targetUserId); // BANNED → room biến khỏi joined-list của target
          break;
        }

        case 'PROMOTE':
          await this.prisma.room_member.updateMany({
            where: { room_id: roomId, user_id: input.targetUserId },
            data: { role: 'MODERATOR' },
          });
          break;

        case 'DEMOTE':
          await this.prisma.room_member.updateMany({
            where: { room_id: roomId, user_id: input.targetUserId },
            data: { role: 'MEMBER' },
          });
          break;
      }

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[moderate] action fail: ${msg}`);
      throw new HttpException({ error: msg }, 500);
    }
  }
}
