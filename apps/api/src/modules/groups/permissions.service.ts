/**
 * PermissionsService — engine quyền study group (legacy role matrix + custom
 * role/channel override). Port NGUYÊN semantics từ apps/web/src/lib/group/
 * {permission-keys,permissions,effective-permissions}.ts (NGUỒN CHUẨN — đồng
 * bộ tay khi web đổi; @cogniva/shared ESM nên api CJS không import được).
 *
 * 3 lớp resolve trong `effectivePermissions` (spec study-group-v2 §G1):
 *   1. Union permissions từ MỌI role assigned (member_role) — ai có là có.
 *   2. Role channel override theo position ASC (role cao override sau).
 *   3. User channel override — beat mọi role override.
 * OWNER (legacy_role='OWNER') bypass all-true. Member chưa migrate custom
 * role → fallback matrix legacy theo studyGroupMember.role.
 */
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/database/prisma.service';

/* ── Permission keys + types (client-safe constants cũ ở permission-keys.ts) ── */

/** 27 permission key Discord-style — general / membership / text / voice / stage. */
export type PermissionKey =
  // General
  | 'manageGroup'
  | 'manageRoles'
  | 'manageChannels'
  | 'viewAuditLog'
  // Membership
  | 'kickMembers'
  | 'banMembers'
  | 'inviteMembers'
  | 'changeNickname'
  // Text channel
  | 'viewChannel'
  | 'sendMessages'
  | 'sendMessagesInThreads'
  | 'embedLinks'
  | 'attachFiles'
  | 'addReactions'
  | 'useExternalEmoji'
  | 'mentionEveryone'
  | 'manageMessages'
  | 'manageThreads'
  // Voice channel
  | 'connect'
  | 'speak'
  | 'video'
  | 'screenShare'
  | 'muteMembers'
  | 'deafenMembers'
  | 'moveMembers'
  // Stage
  | 'requestToSpeak'
  | 'moderateStage';

export type PermissionMap = Partial<Record<PermissionKey, boolean>>;

export type OverrideValue = 'allow' | 'deny' | 'inherit';
export type OverrideMap = Partial<Record<PermissionKey, OverrideValue>>;

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
  'manageGroup',
  'manageRoles',
  'manageChannels',
  'viewAuditLog',
  'kickMembers',
  'banMembers',
  'inviteMembers',
  'changeNickname',
  'viewChannel',
  'sendMessages',
  'sendMessagesInThreads',
  'embedLinks',
  'attachFiles',
  'addReactions',
  'useExternalEmoji',
  'mentionEveryone',
  'manageMessages',
  'manageThreads',
  'connect',
  'speak',
  'video',
  'screenShare',
  'muteMembers',
  'deafenMembers',
  'moveMembers',
  'requestToSpeak',
  'moderateStage',
];

/* ── Legacy role matrix (cũ ở permissions.ts) ────────────────────────────── */

export type GroupRole = 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';

export const ROLE_RANK: Record<GroupRole, number> = {
  OWNER: 100,
  ADMIN: 75,
  MODERATOR: 50,
  MEMBER: 10,
};

/** Action mod/admin có thể làm trong group. */
export type GroupAction =
  // Message
  | 'message.send'
  | 'message.edit-own'
  | 'message.delete-own'
  | 'message.delete-any'
  | 'message.react'
  | 'message.pin'
  // Voice
  | 'voice.connect'
  | 'voice.mute-self'
  | 'voice.mute-other'
  | 'voice.kick-from-voice'
  | 'voice.record'
  // Channel
  | 'channel.create'
  | 'channel.update'
  | 'channel.delete'
  | 'channel.reorder'
  // Member
  | 'member.kick'
  | 'member.ban'
  | 'member.mute'
  | 'member.change-role'
  | 'member.change-nickname'
  // Invite
  | 'invite.create'
  | 'invite.revoke'
  // Group
  | 'group.update-meta'
  | 'group.delete';

/**
 * Bảng cấp phép — minRank cần để thực hiện action.
 * Owner (rank 100) qua mọi check. Action không trong matrix → default DENY.
 */
const ACTION_MIN_RANK: Record<GroupAction, number> = {
  // Message — mọi member chat/react/edit-own
  'message.send': ROLE_RANK.MEMBER,
  'message.edit-own': ROLE_RANK.MEMBER,
  'message.delete-own': ROLE_RANK.MEMBER,
  'message.react': ROLE_RANK.MEMBER,
  'message.delete-any': ROLE_RANK.MODERATOR,
  'message.pin': ROLE_RANK.MODERATOR,
  // Voice
  'voice.connect': ROLE_RANK.MEMBER,
  'voice.mute-self': ROLE_RANK.MEMBER,
  'voice.mute-other': ROLE_RANK.MODERATOR,
  'voice.kick-from-voice': ROLE_RANK.MODERATOR,
  'voice.record': ROLE_RANK.MODERATOR,
  // Channel — admin+ mới CRUD
  'channel.create': ROLE_RANK.ADMIN,
  'channel.update': ROLE_RANK.ADMIN,
  'channel.delete': ROLE_RANK.ADMIN,
  'channel.reorder': ROLE_RANK.ADMIN,
  // Member — mod mute, admin kick/ban/role/nickname
  'member.mute': ROLE_RANK.MODERATOR,
  'member.change-nickname': ROLE_RANK.MODERATOR,
  'member.kick': ROLE_RANK.ADMIN,
  'member.ban': ROLE_RANK.ADMIN,
  'member.change-role': ROLE_RANK.ADMIN,
  // Invite — member tự tạo invite riêng (như Discord), mod+ revoke bất kỳ
  'invite.create': ROLE_RANK.MEMBER,
  'invite.revoke': ROLE_RANK.MODERATOR,
  // Group meta
  'group.update-meta': ROLE_RANK.ADMIN,
  'group.delete': ROLE_RANK.OWNER,
};

/** Default permissions cho 4 legacy role — match matrix `can()` ở trên. */
const LEGACY_DEFAULTS: Record<GroupRole, PermissionMap> = {
  OWNER: Object.fromEntries(ALL_PERMISSION_KEYS.map((k) => [k, true])) as PermissionMap,
  ADMIN: {
    manageGroup: true,
    manageRoles: true,
    manageChannels: true,
    viewAuditLog: true,
    kickMembers: true,
    banMembers: true,
    inviteMembers: true,
    changeNickname: true,
    viewChannel: true,
    sendMessages: true,
    sendMessagesInThreads: true,
    embedLinks: true,
    attachFiles: true,
    addReactions: true,
    useExternalEmoji: true,
    mentionEveryone: true,
    manageMessages: true,
    manageThreads: true,
    connect: true,
    speak: true,
    video: true,
    screenShare: true,
    muteMembers: true,
    deafenMembers: true,
    moveMembers: true,
    moderateStage: true,
  },
  MODERATOR: {
    inviteMembers: true,
    changeNickname: true,
    viewChannel: true,
    sendMessages: true,
    sendMessagesInThreads: true,
    embedLinks: true,
    attachFiles: true,
    addReactions: true,
    useExternalEmoji: true,
    manageMessages: true,
    connect: true,
    speak: true,
    video: true,
    screenShare: true,
    muteMembers: true,
    requestToSpeak: true,
  },
  MEMBER: {
    inviteMembers: true,
    viewChannel: true,
    sendMessages: true,
    sendMessagesInThreads: true,
    embedLinks: true,
    attachFiles: true,
    addReactions: true,
    useExternalEmoji: true,
    connect: true,
    speak: true,
    video: true,
    screenShare: true,
    requestToSpeak: true,
  },
};

/**
 * Backward-compat: map `GroupAction` (cũ) → `PermissionKey` (mới).
 * Route cũ check `can()`, route mới check `hasPermission()` qua key mới.
 */
export const ACTION_TO_PERMISSION: Partial<Record<GroupAction, PermissionKey>> = {
  'message.send': 'sendMessages',
  'message.delete-any': 'manageMessages',
  'message.pin': 'manageMessages',
  'voice.connect': 'connect',
  'voice.mute-other': 'muteMembers',
  'voice.kick-from-voice': 'moveMembers',
  'channel.create': 'manageChannels',
  'channel.update': 'manageChannels',
  'channel.delete': 'manageChannels',
  'channel.reorder': 'manageChannels',
  'member.kick': 'kickMembers',
  'member.ban': 'banMembers',
  'member.mute': 'muteMembers',
  'member.change-role': 'manageRoles',
  'member.change-nickname': 'changeNickname',
  'invite.create': 'inviteMembers',
  'invite.revoke': 'kickMembers',
  'group.update-meta': 'manageGroup',
};

type RoleRow = {
  id: string;
  position: number;
  permissions: PermissionMap;
  legacyRole: string | null;
};

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check legacy role có thể làm action không.
   * Owner luôn pass. Role null/action chưa định nghĩa → DENY.
   */
  can(role: GroupRole | null | undefined, action: GroupAction): boolean {
    if (!role) return false;
    const rank = ROLE_RANK[role];
    const minRank = ACTION_MIN_RANK[action];
    if (minRank === undefined) return false;
    return rank >= minRank;
  }

  /**
   * So sánh 2 role — A có "cao hơn" B không.
   * Dùng khi admin muốn thay role member khác (chỉ thay role THẤP hơn mình).
   */
  isHigherRole(a: GroupRole, b: GroupRole): boolean {
    return ROLE_RANK[a] > ROLE_RANK[b];
  }

  /**
   * User có đang bị mute trong group không (anti-spam timeout).
   * NULL = không mute; quá hạn → hết mute. Nhận cả `muted_until` (row Prisma
   * snake_case) lẫn `mutedUntil` (chữ ký cũ Drizzle) để route port gọi y như cũ.
   */
  isMuted(member: { mutedUntil?: Date | string | null; muted_until?: Date | string | null }): boolean {
    const until = member.mutedUntil ?? member.muted_until;
    if (!until) return false;
    return new Date(until).getTime() > Date.now();
  }

  /** Error message tiếng Việt khi action bị deny — dùng cho body 403. */
  denyReason(role: GroupRole | null | undefined, action: GroupAction): string {
    if (!role) return 'Bạn không phải thành viên của group này';
    if (!this.can(role, action)) {
      return `Vai trò ${role} không có quyền thực hiện hành động này`;
    }
    return '';
  }

  /**
   * Resolve effective permissions cho 1 member trong 1 channel (optional).
   *
   * @param memberId — `study_group_member.id` (PK membership row, KHÔNG phải user.id)
   * @param channelId — optional, để apply channel-specific override
   * @returns PermissionMap — boolean cho key có permission, undefined = không có
   */
  async effectivePermissions(memberId: string, channelId?: string): Promise<PermissionMap> {
    // 1. Load all roles của member (member_role ⋈ role)
    const roleRows = await this.prisma.study_group_member_role.findMany({
      where: { member_id: memberId },
      select: {
        study_group_role: {
          select: { id: true, position: true, permissions: true, legacy_role: true },
        },
      },
    });
    const roles: RoleRow[] = roleRows.map((r) => ({
      id: r.study_group_role.id,
      position: r.study_group_role.position,
      permissions: (r.study_group_role.permissions ?? {}) as PermissionMap,
      legacyRole: r.study_group_role.legacy_role,
    }));

    // OWNER bypass — full permissions
    if (roles.some((r) => r.legacyRole === 'OWNER')) {
      return { ...LEGACY_DEFAULTS.OWNER };
    }

    // 2. Backward-compat: member chưa migrate (chưa có member_role) → đọc
    // legacy role từ study_group_member.role
    if (roles.length === 0) {
      const m = await this.prisma.study_group_member.findUnique({
        where: { id: memberId },
        select: { role: true },
      });
      if (!m) return {};
      return { ...LEGACY_DEFAULTS[m.role as GroupRole] };
    }

    // 3. Union permissions từ tất cả role assigned.
    // Role managed (legacy) → LEGACY_DEFAULTS, role custom → đọc JSON.
    const map: PermissionMap = {};
    for (const r of roles) {
      const rolePerms =
        r.legacyRole && LEGACY_DEFAULTS[r.legacyRole as GroupRole]
          ? LEGACY_DEFAULTS[r.legacyRole as GroupRole]
          : r.permissions;
      for (const k of ALL_PERMISSION_KEYS) {
        if (rolePerms[k]) map[k] = true;
      }
    }

    // 4. Apply channel-specific overrides
    if (channelId) {
      const overrides = await this.prisma.study_group_channel_permission.findMany({
        where: { channel_id: channelId },
        select: { role_id: true, user_id: true, overrides: true },
      });

      const memberRoleIds = new Set(roles.map((r) => r.id));
      // Tìm user_id (member.user_id) để match user-override
      const memberRow = await this.prisma.study_group_member.findUnique({
        where: { id: memberId },
        select: { user_id: true },
      });
      const userId = memberRow?.user_id;

      // Role override sort theo position ASC — role position cao apply sau (thắng)
      const roleOverrides = overrides
        .filter((o) => o.role_id && memberRoleIds.has(o.role_id))
        .map((o) => {
          const role = roles.find((r) => r.id === o.role_id);
          return { position: role?.position ?? 0, overrides: (o.overrides ?? {}) as OverrideMap };
        })
        .sort((a, b) => a.position - b.position);

      for (const ro of roleOverrides) {
        for (const k of ALL_PERMISSION_KEYS) {
          const v = ro.overrides[k];
          if (v === 'allow') map[k] = true;
          else if (v === 'deny') map[k] = false;
          // 'inherit' hoặc undefined → no-op
        }
      }

      // User override — beat tất cả role override
      const userOverride = overrides.find((o) => o.user_id && o.user_id === userId);
      if (userOverride) {
        const userOv = (userOverride.overrides ?? {}) as OverrideMap;
        for (const k of ALL_PERMISSION_KEYS) {
          const v = userOv[k];
          if (v === 'allow') map[k] = true;
          else if (v === 'deny') map[k] = false;
        }
      }
    }

    return map;
  }

  /** Check 1 permission key — convenience wrapper trên `effectivePermissions`. */
  async hasPermission(memberId: string, key: PermissionKey, channelId?: string): Promise<boolean> {
    const perms = await this.effectivePermissions(memberId, channelId);
    return perms[key] === true;
  }
}
