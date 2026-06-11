import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { onProfileChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../../infra/database/prisma.service';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import type { AdminContext } from '../../../common/admin/admin.guard';
import type { AdminPatchUserInput } from './dto/admin-core.dto';
import { isoOrNull, parseDateParam, parseLimit } from './admin-core.util';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  private async revokeRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refresh_token.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async listUsers(query: {
    q?: string;
    plan?: string;
    status?: string;
    adminOnly?: string;
    cursor?: string;
    limit?: string;
  }) {
    const q = query.q?.trim() ?? '';
    const limit = parseLimit(query.limit);

    const conditions: Prisma.userWhereInput[] = [];
    if (q) {
      conditions.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.plan === 'FREE' || query.plan === 'PRO' || query.plan === 'TEAM') {
      conditions.push({ plan: query.plan });
    }
    if (query.status === 'active') conditions.push({ suspended_at: null });
    else if (query.status === 'suspended') conditions.push({ suspended_at: { not: null } });
    if (query.adminOnly === '1') conditions.push({ admin_role: { not: null } });
    const cursor = parseDateParam(query.cursor);
    if (cursor) conditions.push({ created_at: { lt: cursor } });

    const rows = await this.prisma.user.findMany({
      where: conditions.length > 0 ? { AND: conditions } : undefined,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        plan: true,
        is_public: true,
        admin_role: true,
        suspended_at: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && trimmed.length > 0 ? trimmed[trimmed.length - 1]!.created_at.toISOString() : null;

    let total: number | null = null;
    if (conditions.length === 0) total = await this.prisma.user.count();

    return {
      users: trimmed.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        image: u.image,
        plan: u.plan,
        isPublic: u.is_public,
        adminRole: u.admin_role,
        suspendedAt: isoOrNull(u.suspended_at),
        createdAt: u.created_at.toISOString(),
      })),
      nextCursor,
      total,
    };
  }

  async getUser(id: string) {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        email_verified: true,
        image: true,
        plan: true,
        is_public: true,
        preferences: true,
        admin_role: true,
        suspended_at: true,
        suspend_reason: true,
        parental_consent_status: true,
        date_of_birth: true,
        created_at: true,
        updated_at: true,
      },
    });
    if (!row) throw new NotFoundException({ error: 'User not found' });

    const [docs, conv, fc, grp, stats, recentAudit] = await Promise.all([
      this.prisma.document.count({ where: { user_id: id } }),
      this.prisma.conversation.count({ where: { user_id: id } }),
      this.prisma.flashcard.count({ where: { user_id: id } }),
      this.prisma.study_group_member.count({ where: { user_id: id } }),
      this.prisma.user_stats.findUnique({
        where: { user_id: id },
        select: {
          xp: true,
          current_streak: true,
          longest_streak: true,
          last_activity_date: true,
        },
      }),
      this.prisma.admin_audit_log.findMany({
        where: { target_type: 'user', target_id: id },
        select: { id: true, action: true, admin_id: true, payload: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
    ]);

    return {
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        emailVerified: row.email_verified,
        image: row.image,
        plan: row.plan,
        isPublic: row.is_public,
        preferences: row.preferences,
        adminRole: row.admin_role,
        suspendedAt: isoOrNull(row.suspended_at),
        suspendReason: row.suspend_reason,
        parentalConsentStatus: row.parental_consent_status,
        dateOfBirth: isoOrNull(row.date_of_birth),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      },
      stats: {
        docs,
        conversations: conv,
        flashcards: fc,
        groups: grp,
        xp: stats?.xp ?? 0,
        currentStreak: stats?.current_streak ?? 0,
        longestStreak: stats?.longest_streak ?? 0,
        lastActivityDate: stats?.last_activity_date ?? null,
      },
      recentAudit: recentAudit.map((a) => ({
        id: a.id,
        action: a.action,
        adminId: a.admin_id,
        payload: a.payload,
        createdAt: a.created_at.toISOString(),
      })),
    };
  }

  async patchUser(ctx: AdminContext, id: string, dto: AdminPatchUserInput) {
    const { name, plan, isPublic, reason } = dto;
    if (name === undefined && plan === undefined && isPublic === undefined) {
      throw new BadRequestException({ error: 'Không có field nào để update' });
    }

    return this.audit.withAudit(ctx, 'user.update', { type: 'user', id }, async () => {
      const beforeRow = await this.prisma.user.findUnique({
        where: { id },
        select: { name: true, plan: true, is_public: true },
      });
      if (!beforeRow) throw new Error('User not found');
      const before = { name: beforeRow.name, plan: beforeRow.plan, isPublic: beforeRow.is_public };

      const data: Prisma.userUpdateInput = { updated_at: new Date() };
      if (name !== undefined) data.name = name;
      if (plan !== undefined) data.plan = plan;
      if (isPublic !== undefined) data.is_public = isPublic;

      const updated = await this.prisma.user.update({
        where: { id },
        data,
        select: { name: true, plan: true, is_public: true },
      });
      const after = { name: updated.name, plan: updated.plan, isPublic: updated.is_public };

      await onProfileChanged(id);
      return { before, after, reason, result: { ok: true, after } };
    });
  }

  async suspendUser(ctx: AdminContext, id: string, reason: string) {
    if (id === ctx.userId) {
      throw new BadRequestException({ error: 'Không thể suspend chính mình' });
    }

    return this.audit.withAudit(ctx, 'user.suspend', { type: 'user', id }, async () => {
      const before = await this.prisma.user.findUnique({
        where: { id },
        select: { suspended_at: true, suspend_reason: true, email: true },
      });
      if (!before) throw new Error('User not found');
      if (before.suspended_at) throw new Error('User đã bị suspend từ trước');

      const now = new Date();
      await this.prisma.user.update({
        where: { id },
        data: { suspended_at: now, suspend_reason: reason, updated_at: now },
      });

      await this.prisma.session.deleteMany({ where: { user_id: id } });
      await this.revokeRefreshTokens(id);

      return {
        before: { suspendedAt: null, suspendReason: null },
        after: { suspendedAt: now.toISOString(), suspendReason: reason },
        reason,
        metadata: { targetEmail: before.email },
        result: { ok: true, suspendedAt: now.toISOString() },
      };
    });
  }

  async unsuspendUser(ctx: AdminContext, id: string, reason: string) {
    return this.audit.withAudit(ctx, 'user.unsuspend', { type: 'user', id }, async () => {
      const before = await this.prisma.user.findUnique({
        where: { id },
        select: { suspended_at: true, suspend_reason: true, email: true },
      });
      if (!before) throw new Error('User not found');
      if (!before.suspended_at) throw new Error('User chưa bị suspend');

      await this.prisma.user.update({
        where: { id },
        data: { suspended_at: null, suspend_reason: null, updated_at: new Date() },
      });

      return {
        before: {
          suspendedAt: before.suspended_at.toISOString(),
          suspendReason: before.suspend_reason,
        },
        after: { suspendedAt: null, suspendReason: null },
        reason,
        metadata: { targetEmail: before.email },
        result: { ok: true },
      };
    });
  }

  async forceSignout(ctx: AdminContext, id: string, reason: string) {
    return this.audit.withAudit(ctx, 'user.force_signout', { type: 'user', id }, async () => {
      const target = await this.prisma.user.findUnique({
        where: { id },
        select: { email: true },
      });
      if (!target) throw new Error('User not found');

      const deleted = await this.prisma.session.deleteMany({ where: { user_id: id } });
      await this.revokeRefreshTokens(id);

      return {
        before: { activeSessions: deleted.count },
        after: { activeSessions: 0 },
        reason,
        metadata: { targetEmail: target.email, deletedCount: deleted.count },
        result: { ok: true, deletedSessions: deleted.count },
      };
    });
  }
}
