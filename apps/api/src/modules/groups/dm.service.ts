/**
 * DmService — DM 1-1 thread + messages. Port từ apps/web/src/app/api/dm/**
 * (kèm helper apps/web/src/lib/group/dm.ts) — GIỮ NGUYÊN wire shape/status/
 * message; realtime `private-dm-{threadId}` message:new + badge
 * `presence-user-{peerId}` dm:new-message y cũ; chuông gộp 1 dòng/thread
 * (xoá unread cũ cùng thread trước khi insert).
 */
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { dm_thread as DmThreadRow } from '@prisma/client';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../../common/auth/session.types';
import { dmMessageSchema, type CreateDmThreadInput } from './dto/dm.dto';

const LIST_LIMIT_MAX = 100;

/* ── DM helpers — port từ apps/web/src/lib/group/dm.ts ───────────────────── */

/** Trả [smaller, larger] theo lexicographic — unique cặp không phụ thuộc thứ tự. */
function orderUserIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** True nếu uid là 1 trong 2 thành viên của thread. */
function isThreadMember(thread: DmThreadRow, uid: string): boolean {
  return thread.user1_id === uid || thread.user2_id === uid;
}

@Injectable()
export class DmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Thread tồn tại + uid là member — null nếu không (caller trả 403). */
  private async loadThread(threadId: string, uid: string) {
    const t = await this.prisma.dm_thread.findUnique({ where: { id: threadId } });
    if (!t) return null;
    if (!isThreadMember(t, uid)) return null;
    return t;
  }

  // ──────────────────────────────────────────────────────────
  // GET /dm — list threads sorted lastMessageAt DESC, kèm peer info
  // ──────────────────────────────────────────────────────────

  async listThreads(uid: string) {
    const rows = await this.prisma.dm_thread.findMany({
      where: { OR: [{ user1_id: uid }, { user2_id: uid }] },
      orderBy: { last_message_at: 'desc' },
      select: {
        id: true,
        user1_id: true,
        user2_id: true,
        last_message_at: true,
        created_at: true,
      },
    });

    // Resolve peer info — batch query
    const peerIds = rows.map((r) => (r.user1_id === uid ? r.user2_id : r.user1_id));
    const peers = peerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: peerIds } },
          select: { id: true, name: true, image: true },
        })
      : [];
    const peerMap = new Map(peers.map((p) => [p.id, p]));

    const threads = rows.map((r) => {
      const peerId = r.user1_id === uid ? r.user2_id : r.user1_id;
      const peer = peerMap.get(peerId);
      return {
        id: r.id,
        peer: peer ?? { id: peerId, name: 'Unknown', image: null },
        lastMessageAt: r.last_message_at,
        createdAt: r.created_at,
      };
    });

    return { threads };
  }

  // ──────────────────────────────────────────────────────────
  // POST /dm — upsert thread (idempotent). Route cũ bọc try/catch toàn handler
  // → lỗi bất ngờ thành 500 "DM endpoint crash: ..." (giữ nguyên hành vi).
  // ──────────────────────────────────────────────────────────

  async createThread(uid: string, input: CreateDmThreadInput) {
    try {
      if (input.peerUserId === uid) {
        throw new BadRequestException({ error: 'Không thể DM chính mình' });
      }

      // Verify peer exists
      const peer = await this.prisma.user.findUnique({
        where: { id: input.peerUserId },
        select: { id: true, name: true, image: true },
      });
      if (!peer) throw new NotFoundException({ error: 'User không tồn tại' });

      const [user1Id, user2Id] = orderUserIds(uid, input.peerUserId);

      // Upsert: nếu thread đã có → return 200; chưa → insert 201
      const existing = await this.prisma.dm_thread.findUnique({
        where: { user1_id_user2_id: { user1_id: user1Id, user2_id: user2Id } },
      });
      if (existing) {
        return { httpStatus: 200, body: { thread: { id: existing.id, peer } } };
      }

      const created = await this.prisma.dm_thread.create({
        data: { id: randomUUID(), user1_id: user1Id, user2_id: user2Id },
      });
      if (!created) {
        throw new InternalServerErrorException({ error: 'Tạo thread thất bại' });
      }

      return { httpStatus: 201, body: { thread: { id: created.id, peer } } };
    } catch (err) {
      // Lỗi đã chủ đích (400/404/500 có body riêng) đi thẳng; còn lại bọc 500.
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[api/dm POST] FAIL', err);
      throw new HttpException({ error: 'DM endpoint crash: ' + msg }, 500);
    }
  }

  // ──────────────────────────────────────────────────────────
  // GET /dm/:threadId/messages — cursor pagination (before + limit)
  // ──────────────────────────────────────────────────────────

  async listMessages(uid: string, threadId: string, beforeId: string | null, limitRaw?: string) {
    const t = await this.loadThread(threadId, uid);
    if (!t) throw new ForbiddenException({ error: 'Forbidden' });

    const limit = Math.min(Math.max(Number(limitRaw ?? 50), 1), LIST_LIMIT_MAX);

    let beforeDate: Date | null = null;
    if (beforeId) {
      const c = await this.prisma.dm_message.findUnique({
        where: { id: beforeId },
        select: { created_at: true },
      });
      if (c) beforeDate = c.created_at;
    }

    const rows = await this.prisma.dm_message.findMany({
      where: beforeDate
        ? { thread_id: threadId, created_at: { lt: beforeDate } }
        : { thread_id: threadId },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        thread_id: true,
        author_id: true,
        content: true,
        reply_to_id: true,
        attachments: true,
        reactions: true,
        edited_at: true,
        deleted_at: true,
        created_at: true,
        user: { select: { name: true, image: true } },
      },
    });

    const messages = rows.map((r) => ({
      id: r.id,
      threadId: r.thread_id,
      authorId: r.author_id,
      authorName: r.user.name,
      authorImage: r.user.image,
      content: r.content,
      replyToId: r.reply_to_id,
      attachments: r.attachments,
      reactions: r.reactions,
      editedAt: r.edited_at,
      deletedAt: r.deleted_at,
      createdAt: r.created_at,
    }));

    return { messages: messages.reverse(), hasMore: rows.length === limit };
  }

  // ──────────────────────────────────────────────────────────
  // POST /dm/:threadId/messages — body parse SAU check thread (403 trước 400)
  // ──────────────────────────────────────────────────────────

  async createMessage(user: AuthUser, threadId: string, raw: unknown) {
    const t = await this.loadThread(threadId, user.id);
    if (!t) throw new ForbiddenException({ error: 'Forbidden' });

    const parsed = dmMessageSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    const created = await this.prisma.dm_message.create({
      data: {
        id: randomUUID(),
        thread_id: threadId,
        author_id: user.id,
        content: parsed.data.content ?? '',
        reply_to_id: parsed.data.replyToId ?? null,
        attachments:
          parsed.data.attachments && parsed.data.attachments.length > 0
            ? (parsed.data.attachments as Prisma.InputJsonValue)
            : Prisma.DbNull,
      },
    });
    if (!created) {
      throw new InternalServerErrorException({ error: 'Tạo message thất bại' });
    }

    // Update lastMessageAt
    await this.prisma.dm_thread.update({
      where: { id: threadId },
      data: { last_message_at: created.created_at },
    });

    const payload = {
      id: created.id,
      threadId: created.thread_id,
      authorId: created.author_id,
      authorName: user.name,
      authorImage: user.image,
      content: created.content,
      replyToId: created.reply_to_id,
      attachments: created.attachments,
      reactions: created.reactions,
      editedAt: created.edited_at,
      deletedAt: created.deleted_at,
      createdAt: created.created_at,
    };
    void triggerEvent(`private-dm-${threadId}`, 'message:new', payload);
    // Notify peer (presence-user-{peerId}) để badge sidebar
    const peerId = t.user1_id === user.id ? t.user2_id : t.user1_id;
    void triggerEvent(`presence-user-${peerId}`, 'dm:new-message', {
      threadId,
      authorId: user.id,
      authorName: user.name,
      preview: created.content.slice(0, 100),
    });

    // Thông báo vào chuông cho peer — GỘP 1 dòng/thread (xoá unread cũ cùng
    // thread rồi insert mới) để chuông không spam mỗi tin nhắn. Non-blocking.
    const preview = created.content.slice(0, 80) || '📎 Đã gửi tệp';
    void (async () => {
      try {
        // data->>'threadId' qua raw SQL — copy nguyên semantics filter jsonb cũ
        await this.prisma.$executeRaw(Prisma.sql`
          DELETE FROM notification_log
          WHERE user_id = ${peerId}
            AND type = 'dm-message'
            AND read_at IS NULL
            AND data->>'threadId' = ${threadId}`);
        await this.notifications.createNotification({
          userId: peerId,
          type: 'dm-message',
          title: `Tin nhắn từ ${user.name ?? 'người dùng'}`,
          body: preview,
          data: {
            threadId,
            author: {
              id: user.id,
              name: user.name ?? null,
              image: user.image ?? null,
            },
          },
        });
      } catch (e) {
        console.error('[dm notify]', e);
      }
    })();

    return { message: payload };
  }
}
