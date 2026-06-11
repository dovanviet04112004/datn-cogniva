import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { onGroupReadChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import { markReadSchema, notificationSettingSchema } from './dto/channels.dto';

const THREADS_LIMIT_MAX = 50;
const FORUM_LIMIT_MAX = 50;
const SORT_OPTIONS = ['latest', 'newest', 'replies'] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

type ThreadRow = {
  id: string;
  title: string | null;
  content: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  threadCount: number;
  threadLastAt: Date | null;
  createdAt: Date;
  archivedAt: Date | null;
};

type ForumPostRow = {
  id: string;
  title: string | null;
  content: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  tags: unknown;
  replyCount: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  pinned: boolean;
  hasSolution: boolean;
};

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  private async verifyMember(channelId: string, userId: string) {
    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true },
    });
    if (!ch) return null;
    const m = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: userId } },
      select: { id: true },
    });
    return m ? { groupId: ch.group_id, memberId: m.id } : null;
  }

  async listThreads(
    uid: string,
    channelId: string,
    q: { limit?: string; before?: string; includeArchived?: string },
  ) {
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

    const limit = Math.min(Math.max(Number(q.limit ?? 20), 1), THREADS_LIMIT_MAX);
    const includeArchived = q.includeArchived === '1';

    const conditions: Prisma.Sql[] = [
      Prisma.sql`m.channel_id = ${channelId}`,
      Prisma.sql`m.thread_root_id IS NULL`,
      Prisma.sql`m.deleted_at IS NULL`,
      Prisma.sql`m.thread_count > 0`,
    ];
    if (!includeArchived) {
      conditions.push(Prisma.sql`m.archived_at IS NULL`);
    }
    if (q.before) {
      const d = new Date(q.before);
      if (!Number.isNaN(d.getTime())) {
        conditions.push(Prisma.sql`m.thread_last_at < ${d}`);
      }
    }

    const rows = await this.prisma.$queryRaw<ThreadRow[]>(Prisma.sql`
      SELECT m.id, m.title, m.content,
             m.author_id AS "authorId", u.name AS "authorName", u.image AS "authorImage",
             m.thread_count AS "threadCount", m.thread_last_at AS "threadLastAt",
             m.created_at AS "createdAt", m.archived_at AS "archivedAt"
      FROM study_group_message m
      INNER JOIN "user" u ON u.id = m.author_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY COALESCE(m.thread_last_at, m.created_at) DESC
      LIMIT ${limit}
    `);

    return {
      threads: rows.map((r) => ({
        ...r,
        content: r.content.length > 140 ? r.content.slice(0, 140) + '…' : r.content,
      })),
      hasMore: rows.length === limit,
    };
  }

  async listForum(
    uid: string,
    channelId: string,
    q: { limit?: string; before?: string; tag?: string; sort?: string },
  ) {
    const ch = await this.prisma.study_group_channel.findUnique({ where: { id: channelId } });
    if (!ch) throw new HttpException({ error: 'Channel not found' }, 404);
    if (ch.type !== 'FORUM') {
      throw new HttpException({ error: 'Channel không phải FORUM' }, 400);
    }

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: uid } },
      select: { id: true },
    });
    if (!member) throw new HttpException({ error: 'Forbidden' }, 403);

    const limit = Math.min(Math.max(Number(q.limit ?? 20), 1), FORUM_LIMIT_MAX);
    const sortParam = (q.sort ?? 'latest') as SortOption;
    const sort: SortOption = SORT_OPTIONS.includes(sortParam) ? sortParam : 'latest';

    const conditions: Prisma.Sql[] = [
      Prisma.sql`m.channel_id = ${channelId}`,
      Prisma.sql`m.thread_root_id IS NULL`,
      Prisma.sql`m.deleted_at IS NULL`,
    ];
    if (q.before && sort === 'latest') {
      const beforeDate = new Date(q.before);
      if (!Number.isNaN(beforeDate.getTime())) {
        conditions.push(Prisma.sql`COALESCE(m.thread_last_at, m.created_at) < ${beforeDate}`);
      }
    }
    if (q.tag) {
      conditions.push(Prisma.sql`m.tags @> ${JSON.stringify([q.tag.toLowerCase()])}::jsonb`);
    }

    const orderBy =
      sort === 'newest'
        ? Prisma.sql`m.pinned DESC, m.created_at DESC`
        : sort === 'replies'
          ? Prisma.sql`m.pinned DESC, m.thread_count DESC, m.created_at DESC`
          : Prisma.sql`m.pinned DESC, COALESCE(m.thread_last_at, m.created_at) DESC`;

    const rows = await this.prisma.$queryRaw<ForumPostRow[]>(Prisma.sql`
      SELECT m.id, m.title, m.content,
             m.author_id AS "authorId", u.name AS "authorName", u.image AS "authorImage",
             m.tags, m.thread_count AS "replyCount", m.thread_last_at AS "lastActivityAt",
             m.created_at AS "createdAt", m.pinned,
             EXISTS (
               SELECT 1 FROM study_group_message sol
               WHERE sol.thread_root_id = m.id
                 AND sol.is_solution = true
             ) AS "hasSolution"
      FROM study_group_message m
      INNER JOIN "user" u ON u.id = m.author_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${orderBy}
      LIMIT ${limit}
    `);

    return {
      posts: rows.map((r) => ({
        ...r,
        content: r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content,
      })),
      hasMore: rows.length === limit,
      availableTags: ch.available_tags ?? [],
      sort,
    };
  }

  async listPinned(uid: string, channelId: string) {
    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true },
    });
    if (!ch) throw new HttpException({ error: 'Channel không tồn tại' }, 404);

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: uid } },
      select: { id: true },
    });
    if (!member) throw new HttpException({ error: 'Forbidden' }, 403);

    const rows = await this.prisma.study_group_message.findMany({
      where: { channel_id: channelId, pinned: true, deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: 50,
      select: {
        id: true,
        author_id: true,
        content: true,
        attachments: true,
        created_at: true,
        user: { select: { name: true } },
      },
    });

    return {
      pinned: rows.map((r) => ({
        id: r.id,
        authorId: r.author_id,
        authorName: r.user.name,
        content: r.content,
        attachments: r.attachments,
        createdAt: r.created_at,
      })),
    };
  }

  async getReadState(uid: string, channelId: string) {
    const row = await this.prisma.study_group_read_state.findUnique({
      where: { user_id_channel_id: { user_id: uid, channel_id: channelId } },
      select: { last_read_message_id: true },
    });
    return { lastReadMessageId: row?.last_read_message_id ?? null };
  }

  async markRead(uid: string, channelId: string, raw: unknown) {
    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true },
    });
    if (!ch) throw new HttpException({ error: 'Channel không tồn tại' }, 404);

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: uid } },
      select: { id: true },
    });
    if (!member) throw new HttpException({ error: 'Forbidden' }, 403);

    const parsed = markReadSchema.safeParse(raw);
    if (!parsed.success) throw new HttpException({ error: parsed.error.flatten() }, 400);

    await this.prisma.study_group_read_state.upsert({
      where: { user_id_channel_id: { user_id: uid, channel_id: channelId } },
      create: {
        user_id: uid,
        channel_id: channelId,
        last_read_message_id: parsed.data.lastMessageId,
        updated_at: new Date(),
      },
      update: {
        last_read_message_id: parsed.data.lastMessageId,
        updated_at: new Date(),
      },
    });

    await onGroupReadChanged(ch.group_id, uid);

    return { ok: true };
  }

  async getNotificationSetting(uid: string, channelId: string) {
    const ok = await this.verifyMember(channelId, uid);
    if (!ok) throw new HttpException({ error: 'Forbidden' }, 403);

    const row = await this.prisma.study_group_read_state.findUnique({
      where: { user_id_channel_id: { user_id: uid, channel_id: channelId } },
      select: { notification_setting: true, muted: true },
    });

    return { setting: row?.notification_setting ?? 'all' };
  }

  async putNotificationSetting(uid: string, channelId: string, raw: unknown) {
    const ok = await this.verifyMember(channelId, uid);
    if (!ok) throw new HttpException({ error: 'Forbidden' }, 403);

    const parsed = notificationSettingSchema.safeParse(raw);
    if (!parsed.success) throw new HttpException({ error: parsed.error.flatten() }, 400);

    const muted = parsed.data.setting === 'none';

    await this.prisma.study_group_read_state.upsert({
      where: { user_id_channel_id: { user_id: uid, channel_id: channelId } },
      create: {
        user_id: uid,
        channel_id: channelId,
        notification_setting: parsed.data.setting,
        muted,
        updated_at: new Date(),
      },
      update: {
        notification_setting: parsed.data.setting,
        muted,
        updated_at: new Date(),
      },
    });

    await onGroupReadChanged(ok.groupId, uid);

    return { setting: parsed.data.setting };
  }
}
