/**
 * RoomChatService — port từ apps/web/src/app/api/rooms/[id]/{chat,ai-message}/route.ts.
 * Save DB trước → broadcast sau (DB fail thì không phát message giả); event
 * realtime giữ NGUYÊN tên kênh + event + payload route cũ.
 */
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

  /** GET /rooms/:id/chat — 50 message gần nhất + leftJoin user info, trả chronological. */
  async listMessages(uid: string, roomId: string) {
    if (!(await this.rooms.isActiveMember(roomId, uid))) {
      throw new ForbiddenException({ error: 'Not a member' });
    }

    const rows = await this.prisma.room_message.findMany({
      where: { room_id: roomId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    // room_message.user_id KHÔNG có FK (AI_TUTOR không phải user thật) — route
    // cũ leftJoin; ở đây lookup map, user không tồn tại → name/image null y leftJoin.
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

    // Reverse để hiển thị chronological (cũ → mới)
    return { messages: messages.reverse() };
  }

  /** POST /rooms/:id/chat — save + broadcast `chat:message` lên presence-room-{id}. */
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

  /**
   * POST /rooms/:id/ai-message — `@AI <câu hỏi>` → tutor trả lời.
   * Member check + rate limit nằm ở controller (429 cần Retry-After header,
   * và route cũ check member TRƯỚC rate limit TRƯỚC parse body).
   *
   * Event flow giữ nguyên: `chat:message` placeholder → `ai:streaming` →
   * (`ai:error` nếu fail) → `ai:complete`. LlmService non-stream nên
   * `ai:streaming` bắn 1 lần với delta = full text (client accumulate theo
   * messageId, tương thích).
   */
  async aiMessage(user: AuthUser, roomId: string, raw: unknown) {
    const userId = user.id;
    const userName = user.name ?? 'Anonymous';

    // 3. Parse body (sau member + rate limit ở controller)
    const parsed = aiMessageSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }
    const userQuery = parsed.data.message;

    // 4. Load room + recent messages
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

    // Reverse (cũ → mới), bỏ SYSTEM/FILE — y route cũ
    const recentMessages: TutorChatMessage[] = recent
      .reverse()
      .filter((m) => m.type === 'TEXT' || m.type === 'AI')
      .map((m) => ({
        role: m.user_id === 'AI_TUTOR' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      }));

    // 5. Insert placeholder AI message — khoá messageId trước khi generate
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

    // 6. Generate + broadcast
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
      // Fire-and-forget y chunk loop cũ — realtime lỗi không hủy persist
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

    // 7. Persist final + broadcast complete. promptTokens/completionTokens = 0:
    // LlmService không trả usage (deviation metadata-only, không lộ ra wire).
    // updateMany: y Drizzle update (no-op nếu room bị xoá cascade giữa chừng).
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
