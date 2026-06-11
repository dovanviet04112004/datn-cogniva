import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import { onGroupChanged, onGroupMembershipChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import {
  ALL_PERMISSION_KEYS,
  PermissionsService,
  type GroupRole,
  type PermissionKey,
  type PermissionMap,
} from './permissions.service';
import { generateInviteCode } from './group-code';
import { toInviteDto, toMemberDto, toRoleDto } from './group.mappers';
import {
  createInviteSchema,
  createRoleSchema,
  muteMemberSchema,
  updateMemberSchema,
  updateRoleSchema,
} from './dto/groups.dto';

function isValidPermissionMap(input: unknown): input is PermissionMap {
  if (typeof input !== 'object' || input === null) return false;
  for (const key of Object.keys(input)) {
    if (!ALL_PERMISSION_KEYS.includes(key as PermissionKey)) return false;
    const v = (input as Record<string, unknown>)[key];
    if (typeof v !== 'boolean') return false;
  }
  return true;
}

type AuditEvent = {
  action: string;
  result: 'success' | 'denied' | 'error';
  actorId?: string | null;
  actorType?: 'user' | 'admin' | 'system' | 'webhook';
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class GroupMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private membership(groupId: string, userId: string) {
    return this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
    });
  }

  private async writeAudit(event: AuditEvent): Promise<void> {
    try {
      await this.prisma.audit_log.create({
        data: {
          id: randomUUID(),
          actor_id: event.actorId ?? null,
          actor_type: event.actorType ?? 'user',
          action: event.action,
          result: event.result,
          resource_type: event.resourceType ?? null,
          resource_id: event.resourceId ?? null,
          metadata: (event.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        },
      });
    } catch (err) {
      logger.warn('audit.write_failed', {
        action: event.action,
        result: event.result,
        actor_id: event.actorId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async listMembers(uid: string, groupId: string) {
    const mine = await this.membership(groupId, uid);
    if (!mine) throw new ForbiddenException({ error: 'Not a member' });

    const members = await cached(ck.groupMembers(groupId), 60, async () => {
      const rows = await this.prisma.study_group_member.findMany({
        where: { group_id: groupId },
        orderBy: { joined_at: 'asc' },
        select: {
          user_id: true,
          role: true,
          nickname: true,
          muted_until: true,
          last_seen_at: true,
          joined_at: true,
          user: {
            select: {
              name: true,
              image: true,
              status: true,
              status_text: true,
              status_emoji: true,
              status_expires_at: true,
            },
          },
        },
      });
      return rows.map((m) => ({
        userId: m.user_id,
        name: m.user.name,
        image: m.user.image,
        role: m.role,
        nickname: m.nickname,
        mutedUntil: m.muted_until,
        lastSeenAt: m.last_seen_at,
        joinedAt: m.joined_at,
        status: m.user.status,
        statusText: m.user.status_text,
        statusEmoji: m.user.status_emoji,
        statusExpiresAt: m.user.status_expires_at,
      }));
    });

    return { members, myRole: mine.role };
  }

  async getMemberDetail(uid: string, groupId: string, targetUserId: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Forbidden' });

    const m = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: targetUserId } },
      select: {
        user_id: true,
        role: true,
        nickname: true,
        joined_at: true,
        user: {
          select: {
            name: true,
            image: true,
            status: true,
            status_text: true,
            status_emoji: true,
            status_expires_at: true,
          },
        },
      },
    });
    if (!m) throw new NotFoundException({ error: 'Member not found' });

    return {
      userId: m.user_id,
      name: m.user.name,
      image: m.user.image,
      role: m.role,
      nickname: m.nickname,
      joinedAt: m.joined_at,
      status: m.user.status,
      statusText: m.user.status_text,
      statusEmoji: m.user.status_emoji,
      statusExpiresAt: m.user.status_expires_at,
    };
  }

  async updateMember(uid: string, groupId: string, targetUserId: string, raw: unknown) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });

    const target = await this.membership(groupId, targetUserId);
    if (!target) throw new NotFoundException({ error: 'Member không tồn tại' });

    const parsed = updateMemberSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    const isSelf = me.user_id === targetUserId;
    const updates: Partial<{ role: GroupRole; nickname: string | null }> = {};

    if (parsed.data.role !== undefined) {
      if (isSelf) {
        throw new BadRequestException({ error: 'Không thể tự đổi role' });
      }
      if (!this.permissions.can(me.role as GroupRole, 'member.change-role')) {
        throw new ForbiddenException({ error: 'Không có quyền đổi role' });
      }
      if (parsed.data.role === 'OWNER' && me.role !== 'OWNER') {
        throw new ForbiddenException({ error: 'Chỉ OWNER mới chuyển quyền sở hữu' });
      }
      if (target.role === 'OWNER' && me.role !== 'OWNER') {
        throw new ForbiddenException({ error: 'Không thể đổi role OWNER' });
      }
      if (me.role === 'ADMIN' && !this.permissions.isHigherRole('ADMIN', parsed.data.role)) {
        throw new ForbiddenException({ error: 'ADMIN chỉ gán role thấp hơn mình' });
      }
      updates.role = parsed.data.role;
    }

    if (parsed.data.nickname !== undefined) {
      if (!isSelf && !this.permissions.can(me.role as GroupRole, 'member.change-nickname')) {
        throw new ForbiddenException({ error: 'Không có quyền đổi nickname' });
      }
      updates.nickname = parsed.data.nickname;
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException({ error: 'Không có gì để update' });
    }

    const updated = await this.prisma.study_group_member.update({
      where: { group_id_user_id: { group_id: groupId, user_id: targetUserId } },
      data: updates,
    });

    await onGroupChanged(groupId);

    if (updates.role) {
      void this.writeAudit({
        action: 'study_group.member.role-changed',
        result: 'success',
        actorId: uid,
        actorType: 'user',
        resourceType: 'study_group',
        resourceId: groupId,
        metadata: {
          targetUserId,
          oldRole: target.role,
          newRole: updates.role,
        },
      });
    }

    return { member: toMemberDto(updated) };
  }

  async removeMember(uid: string, groupId: string, targetUserId: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });

    const isSelf = me.user_id === targetUserId;

    if (isSelf) {
      if (me.role === 'OWNER') {
        throw new BadRequestException({
          error: 'OWNER phải transfer ownership hoặc xoá group trước khi leave',
        });
      }
    } else {
      if (!this.permissions.can(me.role as GroupRole, 'member.kick')) {
        throw new ForbiddenException({ error: 'Không có quyền kick' });
      }
      const target = await this.membership(groupId, targetUserId);
      if (!target) throw new NotFoundException({ error: 'Member không tồn tại' });
      if (!this.permissions.isHigherRole(me.role as GroupRole, target.role as GroupRole)) {
        throw new ForbiddenException({ error: 'Chỉ kick được member role thấp hơn' });
      }
      if (target.role === 'OWNER') {
        throw new ForbiddenException({ error: 'Không thể kick OWNER' });
      }
      const grp = await this.prisma.study_group.findUnique({
        where: { id: groupId },
        select: { owner_user_id: true },
      });
      if (grp?.owner_user_id === targetUserId) {
        throw new ForbiddenException({ error: 'Không thể kick chủ group' });
      }
    }

    await this.prisma.study_group_member.deleteMany({
      where: { group_id: groupId, user_id: targetUserId },
    });

    await onGroupMembershipChanged(targetUserId, groupId);

    if (!isSelf) {
      void this.writeAudit({
        action: 'study_group.member.kicked',
        result: 'success',
        actorId: uid,
        actorType: 'user',
        resourceType: 'study_group',
        resourceId: groupId,
        metadata: { targetUserId },
      });
    }

    return { removed: true, self: isSelf };
  }

  async muteMember(uid: string, groupId: string, targetUserId: string, raw: unknown) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (!this.permissions.can(me.role as GroupRole, 'member.mute')) {
      throw new ForbiddenException({ error: 'Không có quyền mute' });
    }
    if (me.user_id === targetUserId) {
      throw new BadRequestException({ error: 'Không thể mute chính mình' });
    }

    const target = await this.membership(groupId, targetUserId);
    if (!target) throw new NotFoundException({ error: 'Member không tồn tại' });
    if (target.role === 'OWNER') {
      throw new ForbiddenException({ error: 'Không thể mute OWNER' });
    }
    if (!this.permissions.isHigherRole(me.role as GroupRole, target.role as GroupRole)) {
      throw new ForbiddenException({ error: 'Chỉ mute được role thấp hơn' });
    }

    const parsed = muteMemberSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    const mutedUntil = new Date(Date.now() + parsed.data.durationSec * 1000);

    await this.prisma.study_group_member.updateMany({
      where: { group_id: groupId, user_id: targetUserId },
      data: { muted_until: mutedUntil },
    });

    await onGroupChanged(groupId);

    void this.writeAudit({
      action: 'study_group.member.muted',
      result: 'success',
      actorId: uid,
      actorType: 'user',
      resourceType: 'study_group',
      resourceId: groupId,
      metadata: { targetUserId, durationSec: parsed.data.durationSec, until: mutedUntil },
    });

    return { mutedUntil };
  }

  async unmuteMember(uid: string, groupId: string, targetUserId: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (!this.permissions.can(me.role as GroupRole, 'member.mute')) {
      throw new ForbiddenException({ error: 'Không có quyền unmute' });
    }

    await this.prisma.study_group_member.updateMany({
      where: { group_id: groupId, user_id: targetUserId },
      data: { muted_until: null },
    });

    await onGroupChanged(groupId);
    return { unmuted: true };
  }

  async listRoles(uid: string, groupId: string) {
    const member = await this.membership(groupId, uid);
    if (!member) throw new ForbiddenException({ error: 'Forbidden' });

    const rows = await this.prisma.$queryRaw<unknown[]>(Prisma.sql`
      SELECT
        r.id,
        r.name,
        r.color,
        r.position,
        r.permissions,
        r.hoisted,
        r.mentionable,
        r.is_managed AS "isManaged",
        r.legacy_role AS "legacyRole",
        coalesce(mc.n, 0)::int AS "memberCount"
      FROM study_group_role r
      LEFT JOIN (
        SELECT role_id, count(*) AS n
        FROM study_group_member_role
        GROUP BY role_id
      ) mc ON mc.role_id = r.id
      WHERE r.group_id = ${groupId}
      ORDER BY r.position DESC`);

    return { roles: rows };
  }

  async createRole(uid: string, groupId: string, raw: unknown) {
    const member = await this.membership(groupId, uid);
    if (!member) throw new ForbiddenException({ error: 'Forbidden' });

    if (!(await this.permissions.hasPermission(member.id, 'manageRoles'))) {
      throw new ForbiddenException({ error: 'Bạn không có quyền quản lý role' });
    }

    const parsed = createRoleSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    if (!isValidPermissionMap(parsed.data.permissions)) {
      throw new BadRequestException({ error: 'permissions chứa key không hợp lệ' });
    }

    const maxRows = await this.prisma.$queryRaw<Array<{ p: number }>>(Prisma.sql`
      SELECT coalesce(max(position), 0)::int AS p
      FROM study_group_role WHERE group_id = ${groupId}`);
    const nextPos = Math.min((maxRows[0]?.p ?? 0) + 1, 95);

    try {
      const inserted = await this.prisma.study_group_role.create({
        data: {
          id: randomUUID(),
          group_id: groupId,
          name: parsed.data.name,
          color: parsed.data.color,
          position: nextPos,
          permissions: parsed.data.permissions as Prisma.InputJsonValue,
          hoisted: parsed.data.hoisted,
          mentionable: parsed.data.mentionable,
          is_managed: false,
          legacy_role: null,
        },
      });

      return { role: toRoleDto(inserted) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ error: 'Đã có role cùng tên trong group' });
      }
      throw err;
    }
  }

  async updateRole(uid: string, groupId: string, roleId: string, raw: unknown) {
    const member = await this.membership(groupId, uid);
    if (!member) throw new ForbiddenException({ error: 'Forbidden' });
    if (!(await this.permissions.hasPermission(member.id, 'manageRoles'))) {
      throw new ForbiddenException({ error: 'Bạn không có quyền quản lý role' });
    }

    const row = await this.prisma.study_group_role.findFirst({
      where: { id: roleId, group_id: groupId },
      select: { id: true, is_managed: true, legacy_role: true },
    });
    if (!row) throw new NotFoundException({ error: 'Role không tồn tại' });

    const parsed = updateRoleSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) {
      if (row.is_managed) {
        throw new BadRequestException({ error: 'Không đổi được tên role mặc định' });
      }
      updates.name = parsed.data.name;
    }
    if (parsed.data.color !== undefined) updates.color = parsed.data.color;
    if (parsed.data.hoisted !== undefined) updates.hoisted = parsed.data.hoisted;
    if (parsed.data.mentionable !== undefined) updates.mentionable = parsed.data.mentionable;
    if (parsed.data.position !== undefined) {
      if (row.legacy_role === 'OWNER') {
        throw new BadRequestException({ error: 'Không đổi được position của OWNER' });
      }
      updates.position = parsed.data.position;
    }
    if (parsed.data.permissions !== undefined) {
      for (const key of Object.keys(parsed.data.permissions)) {
        if (!ALL_PERMISSION_KEYS.includes(key as PermissionKey)) {
          throw new BadRequestException({ error: `permission key không hợp lệ: ${key}` });
        }
      }
      updates.permissions = parsed.data.permissions;
    }

    try {
      const updated = await this.prisma.study_group_role.update({
        where: { id: roleId },
        data: updates,
      });
      return { role: toRoleDto(updated) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ error: 'Tên role đã tồn tại' });
      }
      throw err;
    }
  }

  async deleteRole(uid: string, groupId: string, roleId: string) {
    const member = await this.membership(groupId, uid);
    if (!member) throw new ForbiddenException({ error: 'Forbidden' });
    if (!(await this.permissions.hasPermission(member.id, 'manageRoles'))) {
      throw new ForbiddenException({ error: 'Bạn không có quyền quản lý role' });
    }

    const row = await this.prisma.study_group_role.findFirst({
      where: { id: roleId, group_id: groupId },
      select: { is_managed: true },
    });
    if (!row) throw new NotFoundException({ error: 'Role không tồn tại' });
    if (row.is_managed) {
      throw new BadRequestException({
        error: 'Không xoá được role mặc định (OWNER/ADMIN/MODERATOR/MEMBER)',
      });
    }

    await this.prisma.study_group_role.delete({ where: { id: roleId } });
    return { ok: true };
  }

  async listInvites(uid: string, groupId: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });

    const rows = await this.prisma.study_group_invite.findMany({
      where: { group_id: groupId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        code: true,
        created_by: true,
        max_uses: true,
        uses_count: true,
        expires_at: true,
        created_at: true,
        user: { select: { name: true } },
      },
    });

    return {
      invites: rows.map((r) => ({
        id: r.id,
        code: r.code,
        createdBy: r.created_by,
        createdByName: r.user.name,
        maxUses: r.max_uses,
        usesCount: r.uses_count,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      })),
    };
  }

  async createInvite(uid: string, groupId: string, raw: unknown) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (!this.permissions.can(me.role as GroupRole, 'invite.create')) {
      throw new ForbiddenException({ error: 'Không có quyền tạo invite' });
    }

    const parsed = createInviteSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    let inserted = null;
    for (let i = 0; i < 5; i++) {
      const code = generateInviteCode();
      try {
        const expiresAt = parsed.data.expiresInSec
          ? new Date(Date.now() + parsed.data.expiresInSec * 1000)
          : null;
        inserted = await this.prisma.study_group_invite.create({
          data: {
            id: randomUUID(),
            group_id: groupId,
            code,
            created_by: uid,
            max_uses: parsed.data.maxUses ?? null,
            expires_at: expiresAt,
          },
        });
        break;
      } catch (err) {
        if (i === 4) throw err;
      }
    }

    return { invite: inserted ? toInviteDto(inserted) : null };
  }

  async revokeInvite(uid: string, groupId: string, code: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });

    const canRevokeAny = this.permissions.can(me.role as GroupRole, 'invite.revoke');

    const invite = await this.prisma.study_group_invite.findFirst({
      where: { group_id: groupId, code },
    });
    if (!invite) throw new NotFoundException({ error: 'Invite không tồn tại' });

    if (!canRevokeAny && invite.created_by !== uid) {
      throw new ForbiddenException({ error: 'Chỉ revoke được invite của chính bạn' });
    }

    await this.prisma.study_group_invite.delete({ where: { id: invite.id } });
    return { deleted: true };
  }
}
