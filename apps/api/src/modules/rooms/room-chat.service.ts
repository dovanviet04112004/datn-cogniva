import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';
import type { AuthUser } from '../../common/auth/session.types';
import { RoomsService } from './rooms.service';
import { RoomTutorService, type TutorChatMessage } from './room-tutor.service';
import { aiMessageSchema, chatMessageSchema } from './dto/rooms.dto';

@Injectable()
export class RoomChatService {
  private readonly logger = new Logger(RoomChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly tutor: RoomTutorService,
  ) {}

  async listMessages(uid: string, roomId: string) {
    if (!(await this.rooms.isActiveMember(roomId, uid))) {
      throw new ForbiddenException({ error: 'Not a member' });
    }

    const rows = await this.prisma.room_message.findMany({
      where: { room_id: roomId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, image: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const messages = rows.map((r) => {
      const u = userMap.get(r.user_id);
      return {
        id: r.id,
        userId: r.user_id,
        content: r.content,
        type: r.type,
        metadata: r.metadata,
        createdAt: r.created_at,
        userName: u?.name ?? null,
        userImage: u?.image ?? null,
      };
    });

    return { messages: messages.reverse() };
  }

  async postMessage(user: AuthUser, roomId: string, raw: unknown) {
    if (!(await this.rooms.isActiveMember(roomId, user.id))) {
      throw new ForbiddenException({ error: 'Not a member' });
    }

    const parsed = chatMessageSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }

    const saved = await this.prisma.room_message.create({
      data: {
        id: randomUUID(),
        room_id: roomId,
        user_id: user.id,
        content: parsed.data.content,
        type: parsed.data.type,
        metadata:
          parsed.data.metadata !== undefined
            ? (parsed.data.metadata as Prisma.InputJsonValue)
            : Prisma.DbNull,
      },
    });

    await triggerEvent(`presence-room-${roomId}`, 'chat:message', {
      id: saved.id,
      userId: user.id,
      userName: user.name,
      userImage: user.image,
      content: saved.content,
      type: saved.type,
      metadata: saved.metadata,
      createdAt: saved.created_at,
    });

    return { ok: true, id: saved.id };
  }

  async aiMessage(user: AuthUser, roomId: string, raw: unknown) {
    const userId = user.id;
    const userName = user.name ?? 'Anonymous';

    const parsed = aiMessageSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }
    const userQuery = parsed.data.message;

    const roomRow = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { name: true, description: true, features: true },
    });
    if (!roomRow) {
      throw new NotFoundException({ error: 'Room not found' });
    }
    const features = (roomRow.features as Record<string, boolean>) ?? {};
    if (features.aiTutor === false) {
      throw new ForbiddenException({ error: 'AI Tutor đã bị tắt trong phòng này' });
    }

    const recent = await this.prisma.room_message.findMany({
      where: { room_id: roomId },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: { user_id: true, content: true, type: true },
    });

    const recentMessages: TutorChatMessage[] = recent
      .reverse()
      .filter((m) => m.type === 'TEXT' || m.type === 'AI')
      .map((m) => ({
        role: m.user_id === 'AI_TUTOR' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      }));

    let placeholder;
    try {
      placeholder = await this.prisma.room_message.create({
        data: {
          id: randomUUID(),
          room_id: roomId,
          user_id: 'AI_TUTOR',
          content: '',
          type: 'AI',
          metadata: { askedByUserId: userId, askedByUserName: userName, status: 'streaming' },
        },
      });
    } catch {
      throw new HttpException({ error: 'Failed to create AI message' }, 500);
    }
    const messageId = placeholder.id;

    await triggerEvent(`presence-room-${roomId}`, 'chat:message', {
      id: messageId,
      userId: 'AI_TUTOR',
      userName: 'AI Tutor',
      userImage: null,
      content: '',
      type: 'AI',
      metadata: { askedByUserId: userId, askedByUserName: userName, status: 'streaming' },
      createdAt: placeholder.created_at,
    });

    let fullText = '';
    let aborted = false;
    let modelId = 'unknown';

    try {
      const result = await this.tutor.answer({
        userQuery,
        askingUserId: userId,
        roomName: roomRow.name,
        roomDescription: roomRow.description,
        recentMessages,
      });
      fullText = result.text;
      modelId = result.modelId;
      void triggerEvent(`presence-room-${roomId}`, 'ai:streaming', {
        messageId,
        delta: fullText,
      });
    } catch (err) {
      aborted = true;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[ai-message] stream fail for room=${roomId} msg=${messageId}: ${msg}`);
      fullText = fullText || '[AI generation failed — vui lòng thử lại]';
      await triggerEvent(`presence-room-${roomId}`, 'ai:error', { messageId, error: msg });
    }

    await this.prisma.room_message.updateMany({
      where: { id: messageId },
      data: {
        content: fullText,
        metadata: {
          askedByUserId: userId,
          askedByUserName: userName,
          status: aborted ? 'error' : 'complete',
          model: modelId,
          promptTokens: 0,
          completionTokens: 0,
        },
      },
    });

    await triggerEvent(`presence-room-${roomId}`, 'ai:complete', {
      messageId,
      content: fullText,
    });

    return {
      ok: true,
      messageId,
      chunksLength: fullText.length,
      aborted,
    };
  }
}
