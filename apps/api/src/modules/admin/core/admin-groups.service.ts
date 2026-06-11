import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import type { AdminContext } from '../../../common/admin/admin.guard';
import { AdminNotifyService } from './admin-notify.service';
import { isoOrNull, parseDateParam, parseLimit } from './admin-core.util';

@Injectable()
export class AdminGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly notify: AdminNotifyService,
  ) {}

  async listGroups(query: { q?: string; status?: string; cursor?: string; limit?: string }) {
    const q = query.q?.trim() ?? '';
    const limit = parseLimit(query.limit);

    const conditions: Prisma.study_groupWhereInput[] = [];
    if (q) conditions.push({ name: { contains: q, mode: 'insensitive' } });
    if (query.status === 'active') conditions.push({ suspended_at: null });
    else if (query.status === 'suspended') conditions.push({ suspended_at: { not: null } });
    else if (query.status === 'public') conditions.push({ is_public: true });
    const cursor = parseDateParam(query.cursor);
    if (cursor) conditions.push({ created_at: { lt: cursor } });

    const rows = await this.prisma.study_group.findMany({
      where: conditions.length > 0 ? { AND: conditions } : undefined,
      select: {
        id: true,
        name: true,
        description: true,
        icon_url: true,
        is_public: true,
        max_members: true,
        suspended_at: true,
        suspend_reason: true,
        created_at: true,
        owner_user_id: true,
        user: { select: { name: true, email: true } },
        _count: { select: { study_group_member: true } },
      },
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && trimmed.length > 0 ? trimmed[trimmed.length - 1]!.created_at.toISOString() : null;

    let total: number | null = null;
    if (conditions.length === 0) total = await this.prisma.study_group.count();

    return {
      groups: trimmed.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        iconUrl: g.icon_url,
        isPublic: g.is_public,
        maxMembers: g.max_members,
        suspendedAt: isoOrNull(g.suspended_at),
        suspendReason: g.suspend_reason,
        createdAt: g.created_at.toISOString(),
        ownerId: g.owner_user_id,
        ownerName: g.user.name,
        ownerEmail: g.user.email,
        memberCount: g._count.study_group_member,
      })),
      nextCursor,
      total,
    };
  }

  async getGroup(id: string) {
    const row = await this.prisma.study_group.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        icon_url: true,
        banner_url: true,
        is_public: true,
        max_members: true,
        invite_code: true,
        suspended_at: true,
        suspend_reason: true,
        created_at: true,
        owner_user_id: true,
        user: { select: { name: true, email: true } },
      },
    });
    if (!row) throw new NotFoundException({ error: 'Group not found' });

    const members = await this.prisma.$queryRaw<
      Array<{
        id: string;
        user_id: string;
        role: string;
        nickname: string | null;
        joined_at: Date;
        muted_until: Date | null;
        user_name: string | null;
        user_email: string | null;
        user_image: string | null;
      }>
    >`
      SELECT m.id, m.user_id, m.role::text AS role, m.nickname, m.joined_at, m.muted_until,
             u.name AS user_name, u.email AS user_email, u.image AS user_image
      FROM "study_group_member" m
      LEFT JOIN "user" u ON u.id = m.user_id
      WHERE m.group_id = ${id}
      ORDER BY CASE m.role::text
                 WHEN 'OWNER' THEN 0
                 WHEN 'ADMIN' THEN 1
                 WHEN 'MODERATOR' THEN 2
                 WHEN 'MEMBER' THEN 3
               END,
               m.joined_at ASC
      LIMIT 200`;

    const [statsRow] = await this.prisma.$queryRaw<
      Array<{ member_count: number; channel_count: number; message_count: number }>
    >`
      SELECT
        (SELECT COUNT(*)::int FROM "study_group_member" WHERE group_id = ${id}) AS member_count,
        (SELECT COUNT(*)::int FROM "study_group_channel" WHERE group_id = ${id}) AS channel_count,
        (SELECT COUNT(*)::int FROM "study_group_message" gm
           JOIN "study_group_channel" gc ON gc.id = gm.channel_id
           WHERE gc.group_id = ${id}) AS message_count`;

    return {
      group: {
        id: row.id,
        name: row.name,
        description: row.description,
        iconUrl: row.icon_url,
        bannerUrl: row.banner_url,
        isPublic: row.is_public,
        maxMembers: row.max_members,
        inviteCode: row.invite_code,
        suspendedAt: isoOrNull(row.suspended_at),
        suspendReason: row.suspend_reason,
        createdAt: row.created_at.toISOString(),
        ownerId: row.owner_user_id,
        ownerName: row.user.name,
        ownerEmail: row.user.email,
      },
      members: members.map((m) => ({
        id: m.id,
        userId: m.user_id,
        role: m.role,
        nickname: m.nickname,
        joinedAt: m.joined_at.toISOString(),
        mutedUntil: isoOrNull(m.muted_until),
        userName: m.user_name,
        userEmail: m.user_email,
        userImage: m.user_image,
      })),
      stats: {
        memberCount: Number(statsRow?.member_count ?? 0),
        channelCount: Number(statsRow?.channel_count ?? 0),
        messageCount: Number(statsRow?.message_count ?? 0),
      },
    };
  }

  async suspendGroup(ctx: AdminContext, id: string, reason: string) {
    const result = await this.audit.withAudit(
      ctx,
      'group.suspend',
      { type: 'group', id },
      async () => {
        const before = await this.prisma.study_group.findUnique({
          where: { id },
          select: { id: true, name: true, suspended_at: true },
        });
        if (!before) throw new Error('Group not found');
        if (before.suspended_at) throw new Error('Group đã suspend rồi');

        const now = new Date();
        await this.prisma.study_group.update({
          where: { id },
          data: { suspended_at: now, suspend_reason: reason },
        });

        const members = await this.prisma.study_group_member.findMany({
          where: { group_id: id },
          select: { user_id: true },
        });

        return {
          before: { id: before.id, name: before.name, suspendedAt: null },
          after: { suspendedAt: now.toISOString(), suspendReason: reason },
          reason,
          metadata: { memberCount: members.length },
          result: {
            ok: true,
            name: before.name,
            memberIds: members.map((m) => m.user_id),
          },
        };
      },
    );

    void this.notify
      .notifyGroupSuspend({
        groupId: id,
        groupName: result.name,
        memberIds: result.memberIds,
        reason,
        kind: 'suspend',
      })
      .catch((err) => console.error('[admin group.suspend notify] fail:', err));

    return { ok: true };
  }

  async unsuspendGroup(ctx: AdminContext, id: string, reason: string) {
    const result = await this.audit.withAudit(
      ctx,
      'group.unsuspend',
      { type: 'group', id },
      async () => {
        const before = await this.prisma.study_group.findUnique({
          where: { id },
          select: { id: true, name: true, suspended_at: true, suspend_reason: true },
        });
        if (!before) throw new Error('Group not found');
        if (!before.suspended_at) throw new Error('Group không bị suspend');

        await this.prisma.study_group.update({
          where: { id },
          data: { suspended_at: null, suspend_reason: null },
        });

        const members = await this.prisma.study_group_member.findMany({
          where: { group_id: id },
          select: { user_id: true },
        });

        return {
          before: {
            id: before.id,
            name: before.name,
            suspendedAt: before.suspended_at.toISOString(),
            suspendReason: before.suspend_reason,
          },
          after: { suspendedAt: null, suspendReason: null },
          reason,
          result: {
            ok: true,
            name: before.name,
            memberIds: members.map((m) => m.user_id),
          },
        };
      },
    );

    void this.notify
      .notifyGroupSuspend({
        groupId: id,
        groupName: result.name,
        memberIds: result.memberIds,
        reason,
        kind: 'unsuspend',
      })
      .catch((err) => console.error('[admin group.unsuspend notify] fail:', err));

    return { ok: true };
  }

  async deleteGroup(ctx: AdminContext, id: string, reason: string) {
    const memberIds = await this.prisma.study_group_member.findMany({
      where: { group_id: id },
      select: { user_id: true },
    });

    const result = await this.audit.withAudit(
      ctx,
      'group.delete',
      { type: 'group', id },
      async () => {
        const before = await this.prisma.study_group.findUnique({
          where: { id },
          select: { id: true, name: true, owner_user_id: true },
        });
        if (!before) throw new Error('Group not found');

        await this.prisma.study_group.deleteMany({ where: { id } });

        return {
          before: { id: before.id, name: before.name, ownerUserId: before.owner_user_id },
          after: null,
          reason,
          metadata: { memberCount: memberIds.length },
          result: { ok: true, name: before.name },
        };
      },
    );

    void this.notify
      .notifyGroupSuspend({
        groupId: id,
        groupName: result.name,
        memberIds: memberIds.map((m) => m.user_id),
        reason,
        kind: 'delete',
      })
      .catch((err) => console.error('[admin group.delete notify] fail:', err));

    return result;
  }

  async listRecordings(id: string) {
    const rows = await this.prisma.recording.findMany({
      where: { study_group_channel: { group_id: id } },
      select: {
        id: true,
        study_group_channel_id: true,
        created_by: true,
        storage_key: true,
        file_url: true,
        duration_seconds: true,
        file_size_bytes: true,
        status: true,
        started_at: true,
        ended_at: true,
        study_group_channel: { select: { name: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { started_at: 'desc' },
      take: 100,
    });

    return {
      recordings: rows.map((r) => ({
        id: r.id,
        channelId: r.study_group_channel_id,
        channelName: r.study_group_channel?.name ?? null,
        createdBy: r.created_by,
        recorderName: r.user?.name ?? null,
        recorderEmail: r.user?.email ?? null,
        storageKey: r.storage_key,
        fileUrl: r.file_url,
        duration: r.duration_seconds,
        fileSize: r.file_size_bytes,
        status: r.status,
        startedAt: r.started_at.toISOString(),
        endedAt: isoOrNull(r.ended_at),
      })),
    };
  }
}
