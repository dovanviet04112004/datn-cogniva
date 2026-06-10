/**
 * GroupsService — core study group: list/create/join/detail/update/delete +
 * ping/unread/search/audit/resource-search. Port từ apps/web/src/app/api/
 * groups/{route,join,resource-search,[id]/{route,ping,unread,search,audit}}
 * — GIỮ NGUYÊN wire shape, status code, message tiếng Việt, cache key
 * (ck.groupsList/groupDetail/groupUnread) + invalidator nên Next/Nest sống
 * chung không lệch cache.
 *
 * Route cũ đọc qua dbReplica cho read thuần; api 1 PrismaClient (primary) —
 * chấp nhận trong strangler-fig (như search.service).
 */
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import {
  onGroupChanged,
  onGroupMembershipChanged,
} from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../../common/auth/session.types';
import { PermissionsService, type GroupRole } from './permissions.service';
import { generateInviteCode, normalizeInviteCode } from './group-code';
import { parseSearch, toTsQuery } from './group-search-query';
import { toChannelDto, toGroupDto } from './group.mappers';
import {
  updateGroupSchema,
  type CreateGroupInput,
  type JoinGroupInput,
} from './dto/groups.dto';

const SEARCH_MAX_LIMIT = 50;
const AUDIT_MAX_LIMIT = 100;

/** Row search message — alias camelCase đặt ngay trong SQL như Drizzle cũ. */
type SearchRow = {
  id: string;
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  content: string;
  attachments: unknown;
  createdAt: Date;
};

type ResourceRow = { id: string; title: string };

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Membership của user trong group — null nếu không phải member. */
  private membership(groupId: string, userId: string) {
    return this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
    });
  }

  // ──────────────────────────────────────────────────────────
  // GET /groups — sidebar list (cache-aside 60s per-user)
  // ──────────────────────────────────────────────────────────

  async listGroups(uid: string) {
    const rows = await cached(ck.groupsList(uid), 60, () =>
      this.prisma.$queryRaw<unknown[]>(Prisma.sql`
        SELECT
          g.id,
          g.name,
          g.description,
          g.owner_user_id AS "ownerUserId",
          g.invite_code AS "inviteCode",
          g.icon_url AS "iconUrl",
          g.created_at AS "createdAt",
          m.role AS "myRole",
          (SELECT count(*)::int FROM study_group_member WHERE group_id = g.id) AS "memberCount"
        FROM study_group g
        INNER JOIN study_group_member m ON m.group_id = g.id
        WHERE m.user_id = ${uid}
        ORDER BY g.created_at DESC`),
    );
    return { groups: rows };
  }

  // ──────────────────────────────────────────────────────────
  // POST /groups — tạo group + OWNER member + #chung + invite đầu tiên (txn)
  // ──────────────────────────────────────────────────────────

  async createGroup(uid: string, input: CreateGroupInput) {
    const legacyCode = generateInviteCode();
    const inviteCode = generateInviteCode();

    const { group, channel } = await this.prisma.$transaction(async (tx) => {
      const g = await tx.study_group.create({
        data: {
          id: randomUUID(),
          name: input.name,
          description: input.description ?? null,
          owner_user_id: uid,
          invite_code: legacyCode,
        },
      });

      await tx.study_group_member.create({
        data: { id: randomUUID(), group_id: g.id, user_id: uid, role: 'OWNER' },
      });

      const c = await tx.study_group_channel.create({
        data: {
          id: randomUUID(),
          group_id: g.id,
          name: 'chung',
          type: 'TEXT',
          position: 0,
          created_by: uid,
          topic: 'Chat tổng',
        },
      });

      // Invite mặc định — unlimited use, không expires
      await tx.study_group_invite.create({
        data: { id: randomUUID(), group_id: g.id, code: inviteCode, created_by: uid },
      });

      return { group: g, channel: c };
    });

    // Owner vừa được thêm làm member → bust groupsList(owner) để sidebar hiện group mới.
    await onGroupMembershipChanged(uid, group.id);

    return { group: toGroupDto(group), defaultChannel: toChannelDto(channel) };
  }

  // ──────────────────────────────────────────────────────────
  // POST /groups/join — invite mới (max_uses/expiry) → fallback legacy code
  // ──────────────────────────────────────────────────────────

  async joinGroup(user: AuthUser, input: JoinGroupInput) {
    const code = normalizeInviteCode(input.code);

    // Resolve code: prefer new invite table → fallback legacy inviteCode
    const invite = await this.prisma.study_group_invite.findUnique({ where: { code } });

    let groupId: string | null = null;
    let inviteId: string | null = null;

    if (invite) {
      const now = new Date();
      if (invite.expires_at && invite.expires_at < now) {
        throw new HttpException({ error: 'Invite đã hết hạn' }, 410);
      }
      if (invite.max_uses !== null && invite.uses_count >= invite.max_uses) {
        throw new HttpException({ error: 'Invite hết lượt sử dụng' }, 410);
      }
      groupId = invite.group_id;
      inviteId = invite.id;
    } else {
      const legacy = await this.prisma.study_group.findUnique({
        where: { invite_code: code },
        select: { id: true },
      });
      if (!legacy) {
        throw new NotFoundException({ error: 'Invite code không hợp lệ' });
      }
      groupId = legacy.id;
    }

    const group = await this.prisma.study_group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException({ error: 'Group không tồn tại' });

    // Đã là member?
    const existing = await this.membership(group.id, user.id);
    if (existing) {
      return { group: toGroupDto(group), alreadyMember: true };
    }

    // Check maxMembers
    const count = await this.prisma.study_group_member.count({
      where: { group_id: group.id },
    });
    if (count >= group.max_members) {
      throw new HttpException({ error: 'Group đã đầy thành viên' }, 423);
    }

    // Insert member + (nếu invite mới) INCR uses_count — chạy trong txn
    await this.prisma.$transaction(async (tx) => {
      await tx.study_group_member.create({
        data: { id: randomUUID(), group_id: group.id, user_id: user.id, role: 'MEMBER' },
      });
      if (inviteId) {
        await tx.study_group_invite.update({
          where: { id: inviteId },
          data: { uses_count: { increment: 1 } },
        });
      }
    });

    await onGroupMembershipChanged(user.id, group.id);

    // Thông báo cho chủ nhóm: có thành viên mới (realtime, non-blocking).
    if (group.owner_user_id !== user.id) {
      void this.notifications
        .createNotification({
          userId: group.owner_user_id,
          type: 'group-join',
          title: 'Thành viên mới',
          body: `${user.name ?? 'Ai đó'} đã tham gia nhóm ${group.name}.`,
          data: { groupId: group.id },
        })
        .catch((e) => console.error('[group.join notify]', e));
    }

    return { group: toGroupDto(group) };
  }

  // ──────────────────────────────────────────────────────────
  // GET /groups/:id — guard per-user NGOÀI cache, nội dung chung cache 120s
  // ──────────────────────────────────────────────────────────

  async getGroupDetail(uid: string, id: string) {
    const mine = await this.membership(id, uid);
    if (!mine) throw new ForbiddenException({ error: 'Not a member' });

    const detail = await cached(ck.groupDetail(id), 120, async () => {
      const group = await this.prisma.study_group.findUnique({ where: { id } });
      if (!group) return null;

      const [members, channels] = await Promise.all([
        this.prisma.study_group_member.findMany({
          where: { group_id: id },
          orderBy: { joined_at: 'asc' },
          select: {
            user_id: true,
            role: true,
            nickname: true,
            muted_until: true,
            joined_at: true,
            user: { select: { name: true, image: true } },
          },
        }),
        this.prisma.study_group_channel.findMany({
          where: { group_id: id },
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
        }),
      ]);

      return {
        group: toGroupDto(group),
        members: members.map((m) => ({
          userId: m.user_id,
          name: m.user.name,
          image: m.user.image,
          role: m.role,
          nickname: m.nickname,
          mutedUntil: m.muted_until,
          joinedAt: m.joined_at,
        })),
        channels: channels.map(toChannelDto),
      };
    });

    if (!detail) throw new NotFoundException({ error: 'Not found' });

    // myRole lấy từ guard (per-user) — không cache chung, gắn lại vào response.
    return { ...detail, myRole: mine.role };
  }

  // ──────────────────────────────────────────────────────────
  // PUT /groups/:id — ADMIN+ update meta (parse body SAU check 403)
  // ──────────────────────────────────────────────────────────

  async updateGroup(uid: string, id: string, raw: unknown) {
    const me = await this.membership(id, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (!this.permissions.can(me.role as GroupRole, 'group.update-meta')) {
      throw new ForbiddenException({ error: 'Không có quyền sửa group' });
    }

    const parsed = updateGroupSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }

    // Verify recordingLogChannelId thuộc cùng group + là TEXT (chống IDOR)
    if (parsed.data.recordingLogChannelId) {
      const ch = await this.prisma.study_group_channel.findFirst({
        where: { id: parsed.data.recordingLogChannelId, group_id: id },
        select: { id: true, type: true },
      });
      if (!ch) {
        throw new BadRequestException({ error: 'Channel log không thuộc group này' });
      }
      if (ch.type !== 'TEXT' && ch.type !== 'ANNOUNCEMENT') {
        throw new BadRequestException({ error: 'Channel log phải là TEXT hoặc ANNOUNCEMENT' });
      }
    }

    const updated = await this.prisma.study_group.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.description !== undefined && { description: parsed.data.description }),
        ...(parsed.data.iconUrl !== undefined && { icon_url: parsed.data.iconUrl }),
        ...(parsed.data.bannerUrl !== undefined && { banner_url: parsed.data.bannerUrl }),
        ...(parsed.data.maxMembers !== undefined && { max_members: parsed.data.maxMembers }),
        ...(parsed.data.recordingLogChannelId !== undefined && {
          recording_log_channel_id: parsed.data.recordingLogChannelId,
        }),
      },
    });

    await onGroupChanged(id);

    return { group: toGroupDto(updated) };
  }

  // ──────────────────────────────────────────────────────────
  // DELETE /groups/:id — OWNER only (DELETE WHERE owner = uid, 0 row → 403)
  // ──────────────────────────────────────────────────────────

  async deleteGroup(uid: string, id: string) {
    const result = await this.prisma.study_group.deleteMany({
      where: { id, owner_user_id: uid },
    });
    if (result.count === 0) {
      throw new ForbiddenException({ error: 'Not owner or not found' });
    }

    // groupsList của member KHÁC không bust được (invalidator nhận 1 userId) —
    // dựa TTL 60s tự hết hạn, y route cũ.
    await onGroupChanged(id);
    await onGroupMembershipChanged(uid, id);

    return { deleted: true };
  }

  // ──────────────────────────────────────────────────────────
  // GET /groups/:id/unread — per-user badge (cache 30s), 1 query SQL
  // ──────────────────────────────────────────────────────────

  async unread(uid: string, groupId: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });

    const unread = await cached(ck.groupUnread(groupId, uid), 30, async () => {
      // Với mỗi channel TEXT/ANNOUNCEMENT, đếm message sau lastRead (nếu có),
      // trừ message của chính user — copy NGUYÊN SQL route cũ.
      const rows = await this.prisma.$queryRaw<Array<{ channel_id: string; unread: number }>>(
        Prisma.sql`
          SELECT
            c.id AS channel_id,
            (
              SELECT count(*)::int FROM study_group_message m
              WHERE m.channel_id = c.id
                AND m.author_id <> ${uid}
                AND m.deleted_at IS NULL
                AND (
                  rs.last_read_message_id IS NULL
                  OR m.created_at > (
                    SELECT created_at FROM study_group_message
                    WHERE id = rs.last_read_message_id
                  )
                )
            ) AS unread
          FROM study_group_channel c
          LEFT JOIN study_group_read_state rs
            ON rs.channel_id = c.id AND rs.user_id = ${uid}
          WHERE c.group_id = ${groupId}
            AND c.type <> 'VOICE'
            AND (rs.muted IS NULL OR rs.muted = false)
        `,
      );

      const map: Record<string, number> = {};
      for (const row of rows) {
        if (row.unread > 0) map[row.channel_id] = row.unread;
      }
      return map;
    });

    return { unread };
  }

  // ──────────────────────────────────────────────────────────
  // GET /groups/:id/search — Postgres FTS + filter chip Discord-style
  // ──────────────────────────────────────────────────────────

  async searchMessages(uid: string, groupId: string, q: string, limitRaw?: string) {
    const member = await this.membership(groupId, uid);
    if (!member) throw new ForbiddenException({ error: 'Forbidden' });

    const limit = Math.min(Math.max(Number(limitRaw ?? 20), 1), SEARCH_MAX_LIMIT);

    const parsed = parseSearch(q);
    const hasFilters = Object.keys(parsed.filters).length > 0;

    if (parsed.text.trim().length < 2 && !hasFilters) {
      // Route cũ trả 200 kèm field error — KHÔNG phải lỗi HTTP.
      return { results: [], error: 'Cần ≥ 2 ký tự hoặc 1 filter', sort: 'rank' };
    }

    // ── Build WHERE — copy nguyên semantics các mệnh đề Drizzle cũ ──────────
    const whereParts: Prisma.Sql[] = [
      Prisma.sql`c.group_id = ${groupId}`,
      Prisma.sql`m.deleted_at IS NULL`,
    ];

    let useFts = false;
    let tsq = '';
    if (parsed.text.trim().length >= 2) {
      tsq = toTsQuery(parsed.text);
      if (tsq) {
        useFts = true;
        whereParts.push(Prisma.sql`m.search_vec @@ to_tsquery('simple', ${tsq})`);
      }
    }

    if (parsed.filters.from) {
      whereParts.push(Prisma.sql`m.author_id = ${parsed.filters.from}`);
    }
    if (parsed.filters.in) {
      whereParts.push(Prisma.sql`m.channel_id = ${parsed.filters.in}`);
    }
    if (parsed.filters.has) {
      whereParts.push(
        Prisma.sql`m.attachments @> ${JSON.stringify([{ type: parsed.filters.has }])}::jsonb`,
      );
    }
    if (parsed.filters.before) {
      const d = new Date(parsed.filters.before);
      if (!Number.isNaN(d.getTime())) {
        whereParts.push(Prisma.sql`m.created_at < ${d}`);
      }
    }
    if (parsed.filters.after) {
      const d = new Date(parsed.filters.after);
      if (!Number.isNaN(d.getTime())) {
        whereParts.push(Prisma.sql`m.created_at > ${d}`);
      }
    }
    if (parsed.filters.mentions) {
      whereParts.push(
        Prisma.sql`m.mentions @> ${JSON.stringify([{ type: 'user', id: parsed.filters.mentions }])}::jsonb`,
      );
    }

    const orderBy = useFts
      ? Prisma.sql`ts_rank(m.search_vec, to_tsquery('simple', ${tsq})) DESC, m.created_at DESC`
      : Prisma.sql`m.created_at DESC`;

    const rows = await this.prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT
        m.id,
        m.channel_id AS "channelId",
        c.name AS "channelName",
        m.author_id AS "authorId",
        u.name AS "authorName",
        u.image AS "authorImage",
        m.content,
        m.attachments,
        m.created_at AS "createdAt"
      FROM study_group_message m
      INNER JOIN study_group_channel c ON c.id = m.channel_id
      INNER JOIN "user" u ON u.id = m.author_id
      WHERE ${Prisma.join(whereParts, ' AND ')}
      ORDER BY ${orderBy}
      LIMIT ${limit}`);

    // Build snippet — extract đoạn quanh match (copy nguyên logic route cũ)
    const lowerText = parsed.text.trim().toLowerCase();
    const results = rows.map((r) => {
      let snippet = r.content;
      if (lowerText && r.content.length > 160) {
        const firstWord = lowerText.split(' ')[0] ?? lowerText;
        const idx = r.content.toLowerCase().indexOf(firstWord);
        if (idx >= 0) {
          const start = Math.max(0, idx - 60);
          const end = Math.min(r.content.length, idx + 80);
          snippet =
            (start > 0 ? '…' : '') +
            r.content.slice(start, end) +
            (end < r.content.length ? '…' : '');
        } else {
          snippet = r.content.slice(0, 160) + '…';
        }
      } else if (r.content.length > 200) {
        snippet = r.content.slice(0, 200) + '…';
      }
      return { ...r, snippet };
    });

    return {
      results,
      sort: useFts ? 'rank' : 'recent',
      filters: parsed.filters,
      textQuery: parsed.text,
    };
  }

  // ──────────────────────────────────────────────────────────
  // GET /groups/:id/audit — ADMIN+ đọc mod actions
  // ──────────────────────────────────────────────────────────

  async getAuditLog(uid: string, groupId: string, limitRaw?: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (me.role !== 'OWNER' && me.role !== 'ADMIN') {
      throw new ForbiddenException({ error: 'Chỉ ADMIN+ xem audit log' });
    }

    const limit = Math.min(Math.max(Number(limitRaw ?? 50), 1), AUDIT_MAX_LIMIT);

    // Action prefix 'study_group.' VÀ (resource_id = groupId HOẶC metadata->>groupId)
    const rows = await this.prisma.$queryRaw<unknown[]>(Prisma.sql`
      SELECT
        a.id,
        a.actor_id AS "actorId",
        u.name AS "actorName",
        u.image AS "actorImage",
        a.action,
        a.result,
        a.resource_type AS "resourceType",
        a.resource_id AS "resourceId",
        a.metadata,
        a.timestamp
      FROM audit_log a
      LEFT JOIN "user" u ON u.id = a.actor_id
      WHERE a.action LIKE 'study_group.%'
        AND (a.resource_id = ${groupId} OR a.metadata->>'groupId' = ${groupId})
      ORDER BY a.timestamp DESC
      LIMIT ${limit}`);

    return { entries: rows };
  }

  // ──────────────────────────────────────────────────────────
  // GET /groups/resource-search — search resource MÌNH SỞ HỮU để attach
  // ──────────────────────────────────────────────────────────

  async resourceSearch(uid: string, type: string | null, qRaw: string | null) {
    const q = (qRaw ?? '').trim();
    // Empty query OK — list 10 recent items để user pick mà không cần gõ keyword.
    const hasQuery = q.length >= 1;
    // ILIKE %q% raw (giữ semantics wildcard %/_ của Drizzle ilike, như search.service)
    const like = `%${q}%`;

    switch (type) {
      case 'doc': {
        const rows = hasQuery
          ? await this.prisma.$queryRaw<ResourceRow[]>(Prisma.sql`
              SELECT id, filename AS title FROM document
              WHERE user_id = ${uid} AND filename ILIKE ${like} LIMIT 10`)
          : await this.prisma.$queryRaw<ResourceRow[]>(Prisma.sql`
              SELECT id, filename AS title FROM document
              WHERE user_id = ${uid} LIMIT 10`);
        return { items: rows.map((r) => ({ id: r.id, title: r.title, type: 'doc' })) };
      }
      case 'flashcard': {
        const rows = hasQuery
          ? await this.prisma.$queryRaw<Array<{ id: string; front: string }>>(Prisma.sql`
              SELECT id, front FROM flashcard
              WHERE user_id = ${uid} AND front ILIKE ${like} LIMIT 10`)
          : await this.prisma.$queryRaw<Array<{ id: string; front: string }>>(Prisma.sql`
              SELECT id, front FROM flashcard
              WHERE user_id = ${uid} LIMIT 10`);
        return {
          items: rows.map((r) => ({
            id: r.id,
            title: r.front.slice(0, 80),
            type: 'flashcard',
          })),
        };
      }
      case 'exam': {
        const rows = hasQuery
          ? await this.prisma.$queryRaw<ResourceRow[]>(Prisma.sql`
              SELECT id, title FROM exam
              WHERE owner_id = ${uid} AND title ILIKE ${like} LIMIT 10`)
          : await this.prisma.$queryRaw<ResourceRow[]>(Prisma.sql`
              SELECT id, title FROM exam
              WHERE owner_id = ${uid} LIMIT 10`);
        return { items: rows.map((r) => ({ id: r.id, title: r.title, type: 'exam' })) };
      }
      default:
        throw new BadRequestException({ error: 'type must be doc|flashcard|exam' });
    }
  }
}
