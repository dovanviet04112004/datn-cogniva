/**
 * effectivePermissions — V2 G1 compute helper.
 *
 * Spec: docs/plans/study-group-v2.md §G1 (2026-05-21).
 *
 * Compute permission tổng hợp cho 1 member trong 1 channel cụ thể qua 3 lớp:
 *
 *   1. **Union role permissions** — gộp permissions JSON từ MỌI role assigned
 *      cho member (qua bảng study_group_member_role). Role rank cao hơn không
 *      override cấp role thấp ở lớp này — ai có quyền là có.
 *
 *   2. **Role channel overrides** — apply override matrix theo role, sort theo
 *      `position` ASC (role cao position cuối override role thấp). Mỗi override:
 *      `'allow'` → grant, `'deny'` → revoke, `'inherit'` → không động.
 *
 *   3. **User channel override** — override cuối cùng theo user (1 row max per
 *      channel × user). User override "winning move" — beat mọi role override.
 *
 * OWNER bypass: nếu member có role với `legacy_role = 'OWNER'` → return all-true
 * (giống Discord owner).
 *
 * Performance: 1 query với CTE — sub-50ms cho group < 1000 member.
 *
 * Backward-compat: nếu member CHƯA migrate sang custom role (member_role rows
 * rỗng), fallback về `can(legacyRole, action)` của `permissions.ts`. Migration
 * 0036 đã backfill — fallback chỉ chạy khi DB ở state không đầy đủ (dev fresh).
 */
import { and, eq } from 'drizzle-orm';

import {
  db,
  studyGroupChannelPermission,
  studyGroupMember,
  studyGroupMemberRole,
  studyGroupRole,
} from '@cogniva/db';

import { can, type GroupAction, type GroupRole } from './permissions';
import {
  ALL_PERMISSION_KEYS,
  type OverrideMap,
  type PermissionKey,
  type PermissionMap,
} from './permission-keys';

// Re-export client-safe types để API routes import 1 path (backward compat)
export { ALL_PERMISSION_KEYS };
export type { OverrideMap, PermissionKey, PermissionMap };
export type { OverrideValue } from './permission-keys';

/** Default permissions cho 4 legacy role — match `permissions.ts` matrix. */
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

type RoleRow = {
  id: string;
  position: number;
  permissions: PermissionMap;
  legacyRole: string | null;
};

/**
 * Resolve effective permissions cho 1 member trong 1 channel (optional).
 *
 * @param memberId — `studyGroupMember.id` (PK của membership row, KHÔNG phải user.id)
 * @param channelId — optional, để apply channel-specific override
 * @returns PermissionMap với boolean cho mỗi key có permission, undefined = không có
 */
export async function effectivePermissions(
  memberId: string,
  channelId?: string,
): Promise<PermissionMap> {
  // 1. Load all roles của member
  const roles = (await db
    .select({
      id: studyGroupRole.id,
      position: studyGroupRole.position,
      permissions: studyGroupRole.permissions,
      legacyRole: studyGroupRole.legacyRole,
    })
    .from(studyGroupMemberRole)
    .innerJoin(studyGroupRole, eq(studyGroupRole.id, studyGroupMemberRole.roleId))
    .where(eq(studyGroupMemberRole.memberId, memberId))) as RoleRow[];

  // OWNER bypass — full permissions
  if (roles.some((r) => r.legacyRole === 'OWNER')) {
    return { ...LEGACY_DEFAULTS.OWNER };
  }

  // 2. Backward-compat: member chưa migrate (chưa có member_role) → đọc
  // legacy role từ studyGroupMember.role
  if (roles.length === 0) {
    const [m] = await db
      .select({ role: studyGroupMember.role })
      .from(studyGroupMember)
      .where(eq(studyGroupMember.id, memberId))
      .limit(1);
    if (!m) return {};
    return { ...LEGACY_DEFAULTS[m.role as GroupRole] };
  }

  // 3. Union permissions từ tất cả role assigned.
  // Role managed (legacy) → dùng LEGACY_DEFAULTS, role custom → đọc JSON.
  const map: PermissionMap = {};
  for (const r of roles) {
    const rolePerms =
      r.legacyRole && LEGACY_DEFAULTS[r.legacyRole as GroupRole]
        ? LEGACY_DEFAULTS[r.legacyRole as GroupRole]
        : (r.permissions ?? {});
    for (const k of ALL_PERMISSION_KEYS) {
      if (rolePerms[k]) map[k] = true;
    }
  }

  // 4. Apply channel-specific overrides
  if (channelId) {
    const overrides = (await db
      .select({
        roleId: studyGroupChannelPermission.roleId,
        userId: studyGroupChannelPermission.userId,
        overrides: studyGroupChannelPermission.overrides,
      })
      .from(studyGroupChannelPermission)
      .where(eq(studyGroupChannelPermission.channelId, channelId))) as Array<{
      roleId: string | null;
      userId: string | null;
      overrides: OverrideMap;
    }>;

    const memberRoleIds = new Set(roles.map((r) => r.id));
    // Tìm user_id (member.user_id) để match user-override
    const [memberRow] = await db
      .select({ userId: studyGroupMember.userId })
      .from(studyGroupMember)
      .where(eq(studyGroupMember.id, memberId))
      .limit(1);
    const userId = memberRow?.userId;

    // Sort role overrides theo position ASC (cao position last → override sau)
    const roleOverrides = overrides
      .filter((o) => o.roleId && memberRoleIds.has(o.roleId))
      .map((o) => {
        const role = roles.find((r) => r.id === o.roleId);
        return { position: role?.position ?? 0, overrides: o.overrides };
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
    const userOverride = overrides.find((o) => o.userId && o.userId === userId);
    if (userOverride) {
      for (const k of ALL_PERMISSION_KEYS) {
        const v = userOverride.overrides[k];
        if (v === 'allow') map[k] = true;
        else if (v === 'deny') map[k] = false;
      }
    }
  }

  return map;
}

/**
 * Helper: check 1 permission key. Convenience wrapper trên `effectivePermissions`.
 */
export async function hasPermission(
  memberId: string,
  key: PermissionKey,
  channelId?: string,
): Promise<boolean> {
  const perms = await effectivePermissions(memberId, channelId);
  return perms[key] === true;
}

/**
 * Backward-compat: map `GroupAction` (cũ) → `PermissionKey` (mới).
 * Cho phép gradual migration — file API cũ vẫn import `can()`, file mới gọi
 * `hasPermission()` qua key mới.
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

/**
 * Reuse legacy `can()` cho code chưa migrate — same signature. Internal nó
 * vẫn dùng matrix cũ. Code mới prefer `hasPermission(memberId, key, channelId?)`.
 */
export { can };
