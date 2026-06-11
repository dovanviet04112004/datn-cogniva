import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  study_group_member as MemberRow,
  study_group_message as MessageRow,
} from '@prisma/client';
import { logger } from '@cogniva/server-core';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';
import type { AuthUser } from '../../common/auth/session.types';
import { PermissionsService, type GroupRole } from '../groups/permissions.service';
import { MentionNotifyService, parseMentions } from './mention-notify.service';
import { jsonOrDbNull, toMessageRowDto } from './channels.mappers';
import {
  editMessageSchema,
  postMessageSchema,
  reactSchema,
  threadReplySchema,
  type SolutionInput,
} from './dto/channels.dto';

const LIST_LIMIT_MAX = 100;

const MESSAGE_WITH_AUTHOR_SELECT = {
  id: true,
  channel_id: true,
  author_id: true,
  content: true,
  content_type: true,
  reply_to_id: true,
  attachments: true,
  reactions: true,
  mentions: true,
  pinned: true,
  edited_at: true,
  deleted_at: true,
  created_at: true,
  thread_root_id: true,
  thread_count: true,
  thread_last_at: true,
  is_solution: true,
  user: { select: { name: true, image: true } },
} satisfies Prisma.study_group_messageSelect;

type MessageWithAuthor = Prisma.study_group_messageGetPayload<{
  select: typeof MESSAGE_WITH_AUTHOR_SELECT;
}>;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly mentionNotify: MentionNotifyService,
  ) {}

  private async loadContext(channelId: string, userId: string) {
    const ch = await this.prisma.study_group_channel.findUnique({ where: { id: channelId } });
    if (!ch) return null;
    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: userId } },
    });
    if (!member) return null;
    const grp = await this.prisma.study_group.findUnique({
      where: { id: ch.group_id },
      select: { id: true, suspended_at: true, suspend_reason: true },
    });
    return { channel: ch, member, group: grp ?? null };
  }

  async listMessages(
    uid: string,
    channelId: string,
    beforeId: string | null,
    limitRaw: string | undefined,
  ) {
    const ctx = await this.loadContext(channelId, uid);
    if (!ctx) throw new HttpException({ error: 'Forbidden' }, 403);

    const limitParam = Number(limitRaw ?? 50);
    const limit = Math.min(Math.max(limitParam, 1), LIST_LIMIT_MAX);

    let beforeDate: Date | null = null;
    if (beforeId) {
      const cursor = await this.prisma.study_group_message.findUnique({
        where: { id: beforeId },
        select: { created_at: true },
      });
      if (cursor) beforeDate = cursor.created_at;
    }

    const rows = await this.prisma.study_group_message.findMany({
      where: {
        channel_id: channelId,
        thread_root_id: null,
        ...(beforeDate ? { created_at: { lt: beforeDate } } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: MESSAGE_WITH_AUTHOR_SELECT,
    });

    const messages = rows
      .map((r) => ({
        id: r.id,
        channelId: r.channel_id,
        authorId: r.author_id,
        authorName: r.user.name,
        authorImage: r.user.image,
        content: r.content,
        contentType: r.content_type,
        replyToId: r.reply_to_id,
        attachments: r.attachments,
        reactions: r.reactions,
        mentions: r.mentions,
        pinned: r.pinned,
        editedAt: r.edited_at,
        deletedAt: r.deleted_at,
        createdAt: r.created_at,
        threadCount: r.thread_count,
        threadLastAt: r.thread_last_at,
      }))
      .reverse();
    const hasMore = rows.length === limit;

    return { messages, hasMore };
  }

  async postMessage(user: AuthUser, channelId: string, raw: unknown) {
    const ctx = await this.loadContext(channelId, user.id);
    if (!ctx) throw new HttpException({ error: 'Forbidden' }, 403);
    const { channel, member, group } = ctx;

    if (group?.suspended_at) {
      throw new HttpException(
        { error: 'Group đang bị suspend bởi admin', suspendReason: group.suspend_reason },
        423,
      );
    }

    if (channel.type === 'ANNOUNCEMENT') {
      if (!this.perms.can(member.role as GroupRole, 'group.update-meta')) {
        throw new HttpException({ error: 'Channel ANNOUNCEMENT chỉ ADMIN+ post' }, 403);
      }
    } else if (!this.perms.can(member.role as GroupRole, 'message.send')) {
      throw new HttpException({ error: 'Không có quyền gửi message' }, 403);
    }

    if (this.perms.isMuted(member)) {
      throw new HttpException({ error: 'Bạn đang bị mute trong group' }, 403);
    }

    const parsed = postMessageSchema.safeParse(raw);
    if (!parsed.success) throw new HttpException({ error: parsed.error.flatten() }, 400);

    if (channel.slow_mode_seconds && channel.slow_mode_seconds > 0) {
      const lastMsg = await this.prisma.study_group_message.findFirst({
        where: { channel_id: channelId, author_id: user.id },
        orderBy: { created_at: 'desc' },
        select: { created_at: true },
      });
      if (lastMsg) {
        const elapsed = (Date.now() - lastMsg.created_at.getTime()) / 1000;
        if (elapsed < channel.slow_mode_seconds) {
          const wait = Math.ceil(channel.slow_mode_seconds - elapsed);
          throw new HttpException({ error: `Slow mode — chờ ${wait}s nữa`, retryAfter: wait }, 429);
        }
      }
    }

    const mentions = parsed.data.mentions ?? parseMentions(parsed.data.content);

    const isForumPost = channel.type === 'FORUM' && !parsed.data.replyToId;
    if (channel.type === 'FORUM' && isForumPost && !parsed.data.title?.trim()) {
      throw new HttpException({ error: 'Forum post cần tiêu đề' }, 400);
    }

    const created = await this.prisma.study_group_message.create({
      data: {
        id: randomUUID(),
        channel_id: channelId,
        author_id: user.id,
        content: parsed.data.content ?? '',
        reply_to_id: parsed.data.replyToId ?? null,
        attachments: jsonOrDbNull(
          parsed.data.attachments && parsed.data.attachments.length > 0
            ? parsed.data.attachments
            : null,
        ),
        mentions: jsonOrDbNull(mentions.length > 0 ? mentions : null),
        title: isForumPost ? (parsed.data.title?.trim() ?? null) : null,
        tags: jsonOrDbNull(
          isForumPost && parsed.data.tags && parsed.data.tags.length > 0
            ? parsed.data.tags.map((t) => t.toLowerCase().trim()).filter(Boolean)
            : null,
        ),
        thread_last_at: isForumPost ? new Date() : null,
      },
    });

    const payload = {
      id: created.id,
      channelId: created.channel_id,
      authorId: created.author_id,
      authorName: user.name,
      authorImage: user.image ?? null,
      content: created.content,
      contentType: created.content_type,
      replyToId: created.reply_to_id,
      attachments: created.attachments,
      reactions: created.reactions,
      mentions: created.mentions,
      pinned: created.pinned,
      editedAt: created.edited_at,
      deletedAt: created.deleted_at,
      createdAt: created.created_at,
    };
    void triggerEvent(`private-channel-${channelId}`, 'message:new', payload);
    void triggerEvent(`presence-group-${channel.group_id}`, 'message:new-in-channel', {
      channelId,
      authorId: created.author_id,
      messageId: created.id,
    });

    if (mentions.length > 0) {
      void this.mentionNotify.fireMentionEvents({
        groupId: channel.group_id,
        channelId,
        channelName: channel.name,
        messageId: created.id,
        authorId: user.id,
        authorName: user.name ?? 'Người dùng',
        mentions,
        content: created.content,
      });
    }

    return { message: payload };
  }

  private async loadMsgContext(
    channelId: string,
    msgId: string,
    userId: string,
  ): Promise<{ msg: MessageRow; member: MemberRow } | null> {
    const msg = await this.prisma.study_group_message.findFirst({
      where: { id: msgId, channel_id: channelId },
    });
    if (!msg) return null;
    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true },
    });
    if (!ch) return null;
    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: userId } },
    });
    if (!member) return null;
    return { msg, member };
  }

  async editMessage(uid: string, channelId: string, msgId: string, raw: unknown) {
    const ctx = await this.loadMsgContext(channelId, msgId, uid);
    if (!ctx) throw new HttpException({ error: 'Forbidden' }, 403);
    const { msg } = ctx;

    if (msg.author_id !== uid) {
      throw new HttpException({ error: 'Chỉ tác giả mới edit message' }, 403);
    }
    if (msg.deleted_at) {
      throw new HttpException({ error: 'Message đã xoá, không edit được' }, 400);
    }

    const parsed = editMessageSchema.safeParse(raw);
    if (!parsed.success) throw new HttpException({ error: parsed.error.flatten() }, 400);

    if (parsed.data.content === msg.content) {
      return { message: toMessageRowDto(msg) };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.study_group_message_revision.create({
        data: {
          id: randomUUID(),
          message_id: msgId,
          content: msg.content,
          edited_at: msg.edited_at ?? msg.created_at,
        },
      });
      return tx.study_group_message.update({
        where: { id: msgId },
        data: { content: parsed.data.content, edited_at: new Date() },
      });
    });

    void triggerEvent(`private-channel-${channelId}`, 'message:edit', {
      id: updated.id,
      content: updated.content,
      editedAt: updated.edited_at,
    });

    return { message: toMessageRowDto(updated) };
  }

  async deleteMessage(uid: string, channelId: string, msgId: string) {
    const ctx = await this.loadMsgContext(channelId, msgId, uid);
    if (!ctx) throw new HttpException({ error: 'Forbidden' }, 403);
    const { msg, member } = ctx;

    const isOwn = msg.author_id === uid;
    if (!isOwn && !this.perms.can(member.role as GroupRole, 'message.delete-any')) {
      throw new HttpException({ error: 'Không có quyền xoá message' }, 403);
    }
    if (msg.deleted_at) {
      return { deleted: true, alreadyDeleted: true };
    }

    await this.prisma.study_group_message.update({
      where: { id: msgId },
      data: { deleted_at: new Date() },
    });

    void triggerEvent(`private-channel-${channelId}`, 'message:delete', {
      id: msgId,
      deletedBy: uid,
    });

    if (!isOwn) {
      void this.writeAudit({
        action: 'study_group.message.deleted',
        actorId: uid,
        resourceType: 'study_group_message',
        resourceId: msgId,
        metadata: {
          channelId,
          originalAuthorId: msg.author_id,
          contentPreview: msg.content.slice(0, 200),
        },
      });
    }

    return { deleted: true };
  }

  private async writeAudit(e: {
    action: string;
    actorId: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.audit_log.create({
        data: {
          id: randomUUID(),
          actor_id: e.actorId,
          actor_type: 'user',
          action: e.action,
          result: 'success',
          resource_type: e.resourceType,
          resource_id: e.resourceId,
          metadata: e.metadata as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      logger.warn('audit.write_failed', {
        action: e.action,
        result: 'success',
        actor_id: e.actorId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async react(uid: string, channelId: string, msgId: string, raw: unknown) {
    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true },
    });
    if (!ch) throw new HttpException({ error: 'Channel không tồn tại' }, 404);

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: uid } },
    });
    if (!member) throw new HttpException({ error: 'Forbidden' }, 403);
    if (!this.perms.can(member.role as GroupRole, 'message.react')) {
      throw new HttpException({ error: 'Không có quyền react' }, 403);
    }
    if (this.perms.isMuted(member)) {
      throw new HttpException({ error: 'Bạn đang bị mute' }, 403);
    }

    const parsed = reactSchema.safeParse(raw);
    if (!parsed.success) throw new HttpException({ error: parsed.error.flatten() }, 400);
    const emoji = parsed.data.emoji;

    const msg = await this.prisma.study_group_message.findFirst({
      where: { id: msgId, channel_id: channelId },
      select: { reactions: true },
    });
    if (!msg) throw new HttpException({ error: 'Message không tồn tại' }, 404);

    const current: Record<string, string[]> =
      (msg.reactions as Record<string, string[]> | null) ?? {};
    const list = current[emoji] ?? [];
    const idx = list.indexOf(uid);

    if (idx >= 0) {
      list.splice(idx, 1);
      if (list.length === 0) delete current[emoji];
      else current[emoji] = list;
    } else {
      if (!current[emoji] && Object.keys(current).length >= 20) {
        throw new HttpException({ error: 'Đã đạt 20 emoji distinct' }, 400);
      }
      current[emoji] = [...list, uid];
    }

    await this.prisma.study_group_message.update({
      where: { id: msgId },
      data: { reactions: current as Prisma.InputJsonValue },
    });

    void triggerEvent(`private-channel-${channelId}`, 'message:react', {
      id: msgId,
      reactions: current,
    });

    return { reactions: current };
  }

  async togglePin(uid: string, channelId: string, msgId: string) {
    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true },
    });
    if (!ch) throw new HttpException({ error: 'Channel không tồn tại' }, 404);

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: uid } },
      select: { role: true },
    });
    if (!member) throw new HttpException({ error: 'Forbidden' }, 403);
    if (!this.perms.can(member.role as GroupRole, 'message.pin')) {
      throw new HttpException({ error: 'Không có quyền pin' }, 403);
    }

    const msg = await this.prisma.study_group_message.findFirst({
      where: { id: msgId, channel_id: channelId },
      select: { pinned: true },
    });
    if (!msg) throw new HttpException({ error: 'Message không tồn tại' }, 404);

    const newPinned = !msg.pinned;
    await this.prisma.study_group_message.update({
      where: { id: msgId },
      data: { pinned: newPinned },
    });

    void triggerEvent(`private-channel-${channelId}`, 'message:pin', {
      id: msgId,
      pinned: newPinned,
    });

    return { pinned: newPinned };
  }

  async markSolution(uid: string, channelId: string, msgId: string, input: SolutionInput) {
    const msg = await this.prisma.study_group_message.findFirst({
      where: { id: msgId, channel_id: channelId },
    });
    if (!msg) throw new HttpException({ error: 'Message not found' }, 404);
    if (!msg.thread_root_id) {
      throw new HttpException({ error: 'Chỉ reply trong thread mới đánh dấu solution được' }, 400);
    }

    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true, type: true },
    });
    if (!ch) throw new HttpException({ error: 'Channel not found' }, 404);
    if (ch.type !== 'FORUM') {
      throw new HttpException({ error: 'Channel không phải FORUM' }, 400);
    }

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: uid } },
      select: { id: true, role: true },
    });
    if (!member) throw new HttpException({ error: 'Forbidden' }, 403);

    const rootPost = await this.prisma.study_group_message.findUnique({
      where: { id: msg.thread_root_id },
      select: { author_id: true },
    });
    if (!rootPost) throw new HttpException({ error: 'Thread root not found' }, 404);

    const isPostAuthor = rootPost.author_id === uid;
    const isMod = this.perms.can(member.role as GroupRole, 'message.delete-any');
    if (!isPostAuthor && !isMod) {
      throw new HttpException({ error: 'Chỉ tác giả post hoặc mod mới đánh dấu solution' }, 403);
    }

    if (input.mark) {
      await this.prisma.$transaction(async (tx) => {
        await tx.study_group_message.updateMany({
          where: { thread_root_id: msg.thread_root_id!, id: { not: msgId } },
          data: { is_solution: false },
        });
        await tx.study_group_message.update({
          where: { id: msgId },
          data: { is_solution: true },
        });
      });
    } else {
      await this.prisma.study_group_message.update({
        where: { id: msgId },
        data: { is_solution: false },
      });
    }

    void triggerEvent(`private-channel-${channelId}`, 'forum:solution', {
      messageId: msgId,
      threadRootId: msg.thread_root_id,
      isSolution: input.mark,
      by: uid,
    });

    return { ok: true, isSolution: input.mark };
  }

  async history(uid: string, channelId: string, msgId: string) {
    const msg = await this.prisma.study_group_message.findUnique({
      where: { id: msgId },
      select: { content: true, edited_at: true, created_at: true, channel_id: true },
    });
    if (!msg || msg.channel_id !== channelId) {
      throw new HttpException({ error: 'Message not found' }, 404);
    }

    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true },
    });
    if (!ch) throw new HttpException({ error: 'Channel not found' }, 404);

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: uid } },
      select: { id: true },
    });
    if (!member) throw new HttpException({ error: 'Forbidden' }, 403);

    const revisions = await this.prisma.study_group_message_revision.findMany({
      where: { message_id: msgId },
      orderBy: { edited_at: 'desc' },
      take: 50,
      select: { id: true, content: true, edited_at: true },
    });

    return {
      current: {
        content: msg.content,
        editedAt: msg.edited_at,
        createdAt: msg.created_at,
      },
      revisions: revisions.map((r) => ({
        id: r.id,
        content: r.content,
        editedAt: r.edited_at,
      })),
    };
  }

  private async loadThreadCtx(channelId: string, msgId: string, uid: string) {
    const ch = await this.prisma.study_group_channel.findUnique({ where: { id: channelId } });
    if (!ch) return null;
    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: uid } },
    });
    if (!member) return null;
    const root = await this.prisma.study_group_message.findFirst({
      where: { id: msgId, channel_id: channelId },
    });
    if (!root) return null;
    return { channel: ch, member, root };
  }

  private toThreadMessageDto(r: MessageWithAuthor) {
    return {
      id: r.id,
      channelId: r.channel_id,
      authorId: r.author_id,
      authorName: r.user.name,
      authorImage: r.user.image,
      content: r.content,
      contentType: r.content_type,
      replyToId: r.reply_to_id,
      attachments: r.attachments,
      reactions: r.reactions,
      mentions: r.mentions,
      pinned: r.pinned,
      editedAt: r.edited_at,
      deletedAt: r.deleted_at,
      createdAt: r.created_at,
      threadRootId: r.thread_root_id,
      threadCount: r.thread_count,
      threadLastAt: r.thread_last_at,
      isSolution: r.is_solution,
    };
  }

  async threadList(uid: string, channelId: string, msgId: string) {
    const ctx = await this.loadThreadCtx(channelId, msgId, uid);
    if (!ctx) throw new HttpException({ error: 'Forbidden' }, 403);

    const replies = await this.prisma.study_group_message.findMany({
      where: { thread_root_id: msgId },
      orderBy: { created_at: 'asc' },
      select: MESSAGE_WITH_AUTHOR_SELECT,
    });

    const rootRow = await this.prisma.study_group_message.findUnique({
      where: { id: msgId },
      select: MESSAGE_WITH_AUTHOR_SELECT,
    });

    return {
      root: rootRow ? this.toThreadMessageDto(rootRow) : undefined,
      replies: replies.map((r) => this.toThreadMessageDto(r)),
    };
  }

  async threadReply(user: AuthUser, channelId: string, msgId: string, raw: unknown) {
    const ctx = await this.loadThreadCtx(channelId, msgId, user.id);
    if (!ctx) throw new HttpException({ error: 'Forbidden' }, 403);
    const { member, root } = ctx;

    if (root.deleted_at) {
      throw new HttpException({ error: 'Message gốc đã bị xoá' }, 400);
    }
    if (root.thread_root_id) {
      throw new HttpException({ error: 'Không thể tạo thread từ reply (chỉ message root)' }, 400);
    }
    if (!this.perms.can(member.role as GroupRole, 'message.send')) {
      throw new HttpException({ error: 'Không có quyền gửi' }, 403);
    }
    if (this.perms.isMuted(member)) {
      throw new HttpException({ error: 'Bạn đang bị mute' }, 403);
    }

    const parsed = threadReplySchema.safeParse(raw);
    if (!parsed.success) throw new HttpException({ error: parsed.error.flatten() }, 400);

    const result = await this.prisma.$transaction(async (tx) => {
      const reply = await tx.study_group_message.create({
        data: {
          id: randomUUID(),
          channel_id: channelId,
          author_id: user.id,
          content: parsed.data.content ?? '',
          thread_root_id: msgId,
          attachments: jsonOrDbNull(
            parsed.data.attachments && parsed.data.attachments.length > 0
              ? parsed.data.attachments
              : null,
          ),
        },
      });

      await tx.study_group_message.update({
        where: { id: msgId },
        data: {
          thread_count: { increment: 1 },
          thread_last_at: reply.created_at,
          archived_at: null,
        },
      });

      return reply;
    });

    const payload = {
      id: result.id,
      threadRootId: msgId,
      channelId: result.channel_id,
      authorId: result.author_id,
      authorName: user.name,
      authorImage: user.image ?? null,
      content: result.content,
      attachments: result.attachments,
      createdAt: result.created_at,
    };
    void triggerEvent(`private-channel-${channelId}`, 'thread:new-reply', payload);

    return { reply: payload };
  }
}
