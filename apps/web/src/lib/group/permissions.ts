/**
 * Permission matrix cho study group — Phase 20.
 *
 * Hierarchy (cao → thấp):
 *   OWNER     — tạo group, full quyền, không xoá được trừ self leave
 *   ADMIN     — quản trị channel + member, không xoá owner / không thay role owner
 *   MODERATOR — delete msg, mute member, không CRUD channel / không thay role
 *   MEMBER    — chat, voice, react
 *
 * Convention:
 *   - Mọi check qua hàm `can(role, action)` trả boolean.
 *   - Owner luôn pass mọi action — không cần list từng cái.
 *   - Action không trong matrix → default DENY.
 */

import type { StudyGroupMember } from '@cogniva/db';

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
 * Owner (rank 100) qua mọi check.
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

/**
 * Check role có thể làm action không.
 * Owner luôn pass. Role chưa định nghĩa trong matrix → DENY.
 */
export function can(role: GroupRole | null | undefined, action: GroupAction): boolean {
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
export function isHigherRole(a: GroupRole, b: GroupRole): boolean {
  return ROLE_RANK[a] > ROLE_RANK[b];
}

/**
 * User có đang bị mute trong group không (anti-spam timeout).
 * `mutedUntil` NULL = không mute. Quá hạn → coi như đã hết mute.
 */
export function isMuted(member: Pick<StudyGroupMember, 'mutedUntil'>): boolean {
  if (!member.mutedUntil) return false;
  return new Date(member.mutedUntil).getTime() > Date.now();
}

/**
 * Helper trả về error message Vietnamese khi action bị deny.
 * Dùng trong API route khi return 403.
 */
export function denyReason(role: GroupRole | null | undefined, action: GroupAction): string {
  if (!role) return 'Bạn không phải thành viên của group này';
  if (!can(role, action)) {
    return `Vai trò ${role} không có quyền thực hiện hành động này`;
  }
  return '';
}
