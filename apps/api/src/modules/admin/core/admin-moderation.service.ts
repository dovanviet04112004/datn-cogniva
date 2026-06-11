/**
 * AdminModerationService — content reports + context + resolve + banned list.
 *
 * GIỮ NGUYÊN quirk targetType 'message' của route cũ (3 chỗ hiểu KHÁC nhau,
 * cố tình không "sửa" để golden diff khớp):
 *  - takedown: xoá bảng `message` (AI chat)
 *  - warn: lookup author từ `study_group_message`
 *  - context: normalize 'message' → group_message
 * Ban qua resolve KHÔNG xoá session/refresh của user (khác /users/:id/suspend)
 * và không notify — y route cũ.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import type { AdminContext } from '../../../common/admin/admin.guard';
import { AdminNotifyService } from './admin-notify.service';
import type { ResolveReportInput } from './dto/admin-core.dto';
import { isoOrNull, parseDateParam, parseLimit } from './admin-core.util';

const CONTEXT_WINDOW = 2; // 2 message trước + 2 sau

@Injectable()
export class AdminModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly notify: AdminNotifyService,
  ) {}

  // ── GET /admin/moderation/reports ────────────────────────────────
  async listReports(query: {
    status?: string;
    targetType?: string;
    cursor?: string;
    limit?: string;
  }) {
    const status = query.status ?? 'PENDING';
    const limit = parseLimit(query.limit);

    const conditions: Prisma.content_reportWhereInput[] = [{ status }];
    if (query.targetType) conditions.push({ target_type: query.targetType });
    const cursor = parseDateParam(query.cursor);
    if (cursor) conditions.push({ created_at: { lt: cursor } });

    const rows = await this.prisma.content_report.findMany({
      where: { AND: conditions },
      select: {
        id: true,
        reporter_id: true,
        target_type: true,
        target_id: true,
        reason: true,
        status: true,
        resolved_by: true,
        resolved_at: true,
        resolution: true,
        created_at: true,
        user_content_report_reporter_idTouser: { select: { name: true, email: true } },
        user_content_report_resolved_byTouser: { select: { name: true, email: true } },
      },
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && trimmed.length > 0
        ? trimmed[trimmed.length - 1]!.created_at.toISOString()
        : null;

    const pendingCount = await this.prisma.content_report.count({
      where: { status: 'PENDING' },
    });

    return {
      reports: trimmed.map((r) => ({
        id: r.id,
        reporterId: r.reporter_id,
        reporterName: r.user_content_report_reporter_idTouser.name,
        reporterEmail: r.user_content_report_reporter_idTouser.email,
        targetType: r.target_type,
        targetId: r.target_id,
        reason: r.reason,
        status: r.status,
        resolvedBy: r.resolved_by,
        resolverName: r.user_content_report_resolved_byTouser?.name ?? null,
        resolverEmail: r.user_content_report_resolved_byTouser?.email ?? null,
        resolvedAt: isoOrNull(r.resolved_at),
        resolution: r.resolution,
        createdAt: r.created_at.toISOString(),
      })),
      nextCursor,
      pendingCount,
    };
  }

  // ── GET /admin/moderation/context ────────────────────────────────
  async getContext(type: string | undefined, id: string | undefined) {
    const t = type ?? '';
    if (!id) throw new BadRequestException({ error: 'Missing id' });

    const normalized = t === 'message' ? 'group_message' : t;
    if (normalized === 'ai_message') return this.aiMessageContext(id);
    if (normalized === 'group_message') return this.groupMessageContext(id);
    throw new BadRequestException({
      error: `targetType=${t} chưa support context. Hiện support: ai_message, group_message, message.`,
    });
  }

  private async aiMessageContext(id: string) {
    const target = await this.prisma.message.findUnique({
      where: { id },
      select: { id: true, role: true, content: true, conversation_id: true, created_at: true },
    });
    if (!target) throw new NotFoundException({ error: 'Message not found' });

    const select = { id: true, role: true, content: true, created_at: true } as const;
    const [before, after] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          conversation_id: target.conversation_id,
          created_at: { lt: target.created_at },
        },
        select,
        orderBy: { created_at: 'desc' },
        take: CONTEXT_WINDOW,
      }),
      this.prisma.message.findMany({
        where: {
          conversation_id: target.conversation_id,
          created_at: { gt: target.created_at },
        },
        select,
        orderBy: { created_at: 'asc' },
        take: CONTEXT_WINDOW,
      }),
    ]);

    const items = [
      ...before.reverse().map((m) => ({ ...m, isTarget: false })),
      {
        id: target.id,
        role: target.role,
        content: target.content,
        created_at: target.created_at,
        isTarget: true,
      },
      ...after.map((m) => ({ ...m, isTarget: false })),
    ];

    return {
      type: 'ai_message',
      conversationId: target.conversation_id,
      items: items.map((i) => ({
        id: i.id,
        role: i.role,
        content: i.content,
        createdAt: i.created_at.toISOString(),
        isTarget: i.isTarget,
      })),
    };
  }

  private async groupMessageContext(id: string) {
    const target = await this.prisma.study_group_message.findUnique({
      where: { id },
      select: { id: true, channel_id: true, created_at: true },
    });
    if (!target) throw new NotFoundException({ error: 'Message not found' });

    const channel = await this.prisma.study_group_channel.findUnique({
      where: { id: target.channel_id },
      select: { name: true, group_id: true },
    });

    const select = {
      id: true,
      author_id: true,
      content: true,
      created_at: true,
      user: { select: { name: true, email: true } },
    } as const;

    const [before, after, targetWithAuthor] = await Promise.all([
      this.prisma.study_group_message.findMany({
        where: { channel_id: target.channel_id, created_at: { lt: target.created_at } },
        select,
        orderBy: { created_at: 'desc' },
        take: CONTEXT_WINDOW,
      }),
      this.prisma.study_group_message.findMany({
        where: { channel_id: target.channel_id, created_at: { gt: target.created_at } },
        select,
        orderBy: { created_at: 'asc' },
        take: CONTEXT_WINDOW,
      }),
      this.prisma.study_group_message.findUnique({ where: { id }, select }),
    ]);

    const items = [
      ...before.reverse().map((m) => ({ ...m, isTarget: false })),
      ...(targetWithAuthor ? [{ ...targetWithAuthor, isTarget: true }] : []),
      ...after.map((m) => ({ ...m, isTarget: false })),
    ];

    return {
      type: 'group_message',
      channelId: target.channel_id,
      channelName: channel?.name ?? null,
      groupId: channel?.group_id ?? null,
      items: items.map((i) => ({
        id: i.id,
        authorId: i.author_id,
        authorName: i.user.name,
        authorEmail: i.user.email,
        content: i.content,
        createdAt: i.created_at.toISOString(),
        isTarget: i.isTarget,
      })),
    };
  }

  // ── POST /admin/moderation/reports/:id/resolve ───────────────────
  async resolveReport(ctx: AdminContext, id: string, dto: ResolveReportInput) {
    const { resolution, reason } = dto;

    return this.audit.withAudit(
      ctx,
      `report.${resolution}`,
      { type: 'report', id },
      async () => {
        const report = await this.prisma.content_report.findUnique({ where: { id } });
        if (!report) throw new Error('Report not found');
        if (report.status !== 'PENDING') throw new Error('Report đã được xử lý');

        const now = new Date();
        let sideEffect: Record<string, unknown> = {};

        if (resolution === 'takedown') {
          sideEffect = await this.takedownTarget(report.target_type, report.target_id);
        } else if (resolution === 'ban') {
          sideEffect = await this.banTarget(report.target_type, report.target_id, reason);
        } else if (resolution === 'warn') {
          const userId = await this.resolveWarnUserId(report.target_type, report.target_id);
          if (userId) {
            // Route cũ AWAIT notify ở nhánh warn (khác group suspend fire-and-forget).
            await this.notify.notifyWarnUser({
              userId,
              reason,
              context: {
                reportId: report.id,
                targetType: report.target_type,
                targetId: report.target_id,
              },
            });
            sideEffect = { type: 'warn.notification', userId };
          } else {
            sideEffect = {
              skipped: true,
              reason: `Không tìm được userId cho targetType=${report.target_type}`,
            };
          }
        }

        await this.prisma.content_report.update({
          where: { id },
          data: {
            status: 'RESOLVED',
            resolved_by: ctx.userId,
            resolved_at: now,
            resolution,
          },
        });

        return {
          before: { status: report.status, resolution: report.resolution },
          after: { status: 'RESOLVED', resolution, sideEffect },
          reason,
          result: { ok: true, resolution, sideEffect },
        };
      },
    );
  }

  /** Takedown — hard delete content; deleteMany để không-throw khi target đã mất (y drizzle). */
  private async takedownTarget(
    targetType: string,
    targetId: string,
  ): Promise<Record<string, unknown>> {
    switch (targetType) {
      case 'document': {
        await this.prisma.document.deleteMany({ where: { id: targetId } });
        return { type: 'document', deletedId: targetId };
      }
      case 'message': {
        await this.prisma.message.deleteMany({ where: { id: targetId } });
        return { type: 'message', deletedId: targetId };
      }
      case 'conversation': {
        await this.prisma.conversation.deleteMany({ where: { id: targetId } });
        return { type: 'conversation', deletedId: targetId };
      }
      default:
        return { skipped: true, reason: `takedown chưa support targetType=${targetType}` };
    }
  }

  private async resolveWarnUserId(targetType: string, targetId: string): Promise<string | null> {
    if (targetType === 'user') return targetId;
    if (targetType === 'message' || targetType === 'group_message') {
      const m = await this.prisma.study_group_message.findUnique({
        where: { id: targetId },
        select: { author_id: true },
      });
      return m?.author_id ?? null;
    }
    if (targetType === 'ai_message') {
      // Author là user của conversation; skip nếu role ASSISTANT (warn AI vô nghĩa).
      const m = await this.prisma.message.findUnique({
        where: { id: targetId },
        select: { role: true, conversation_id: true },
      });
      if (!m || m.role === 'ASSISTANT') return null;
      const c = await this.prisma.conversation.findUnique({
        where: { id: m.conversation_id },
        select: { user_id: true },
      });
      return c?.user_id ?? null;
    }
    return null;
  }

  private async banTarget(
    targetType: string,
    targetId: string,
    reason: string,
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    switch (targetType) {
      case 'user': {
        await this.prisma.user.updateMany({
          where: { id: targetId },
          data: { suspended_at: now, suspend_reason: reason },
        });
        return { type: 'user.suspend', userId: targetId };
      }
      case 'group': {
        await this.prisma.study_group.updateMany({
          where: { id: targetId },
          data: { suspended_at: now, suspend_reason: reason },
        });
        return { type: 'group.suspend', groupId: targetId };
      }
      default:
        return { skipped: true, reason: `ban chưa support targetType=${targetType}` };
    }
  }

  // ── GET /admin/moderation/banned ─────────────────────────────────
  async listBanned(query: { type?: string; q?: string; limit?: string }) {
    const type = query.type ?? null;
    const q = query.q?.trim() ?? '';
    const limit = parseLimit(query.limit);

    const usersPromise: Promise<
      Array<{
        id: string;
        name: string | null;
        email: string;
        image: string | null;
        suspended_at: Date | null;
        suspend_reason: string | null;
        admin_role: string | null;
      }>
    > =
      type === 'group'
        ? Promise.resolve([])
        : this.prisma.user.findMany({
            where: {
              suspended_at: { not: null },
              ...(q
                ? {
                    OR: [
                      { name: { contains: q, mode: 'insensitive' as const } },
                      { email: { contains: q, mode: 'insensitive' as const } },
                    ],
                  }
                : {}),
            },
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              suspended_at: true,
              suspend_reason: true,
              admin_role: true,
            },
            orderBy: { suspended_at: 'desc' },
            take: limit,
          });

    const groupsPromise: Promise<
      Array<{
        id: string;
        name: string;
        icon_url: string | null;
        suspended_at: Date | null;
        suspend_reason: string | null;
        owner_user_id: string;
      }>
    > =
      type === 'user'
        ? Promise.resolve([])
        : this.prisma.study_group.findMany({
            where: {
              suspended_at: { not: null },
              ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
            },
            select: {
              id: true,
              name: true,
              icon_url: true,
              suspended_at: true,
              suspend_reason: true,
              owner_user_id: true,
            },
            orderBy: { suspended_at: 'desc' },
            take: limit,
          });

    const [users, groups] = await Promise.all([usersPromise, groupsPromise]);

    return {
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        image: u.image,
        suspendedAt: isoOrNull(u.suspended_at),
        suspendReason: u.suspend_reason,
        adminRole: u.admin_role,
      })),
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        iconUrl: g.icon_url,
        suspendedAt: isoOrNull(g.suspended_at),
        suspendReason: g.suspend_reason,
        ownerUserId: g.owner_user_id,
      })),
    };
  }
}
