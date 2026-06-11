import type { StudyGroupMember } from '@cogniva/db';

export type GroupRole = 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';

export const ROLE_RANK: Record<GroupRole, number> = {
  OWNER: 100,
  ADMIN: 75,
  MODERATOR: 50,
  MEMBER: 10,
};

export type GroupAction =
  | 'message.send'
  | 'message.edit-own'
  | 'message.delete-own'
  | 'message.delete-any'
  | 'message.react'
  | 'message.pin'
  | 'voice.connect'
  | 'voice.mute-self'
  | 'voice.mute-other'
  | 'voice.kick-from-voice'
  | 'voice.record'
  | 'channel.create'
  | 'channel.update'
  | 'channel.delete'
  | 'channel.reorder'
  | 'member.kick'
  | 'member.ban'
  | 'member.mute'
  | 'member.change-role'
  | 'member.change-nickname'
  | 'invite.create'
  | 'invite.revoke'
  | 'group.update-meta'
  | 'group.delete';

const ACTION_MIN_RANK: Record<GroupAction, number> = {
  'message.send': ROLE_RANK.MEMBER,
  'message.edit-own': ROLE_RANK.MEMBER,
  'message.delete-own': ROLE_RANK.MEMBER,
  'message.react': ROLE_RANK.MEMBER,
  'message.delete-any': ROLE_RANK.MODERATOR,
  'message.pin': ROLE_RANK.MODERATOR,
  'voice.connect': ROLE_RANK.MEMBER,
  'voice.mute-self': ROLE_RANK.MEMBER,
  'voice.mute-other': ROLE_RANK.MODERATOR,
  'voice.kick-from-voice': ROLE_RANK.MODERATOR,
  'voice.record': ROLE_RANK.MODERATOR,
  'channel.create': ROLE_RANK.ADMIN,
  'channel.update': ROLE_RANK.ADMIN,
  'channel.delete': ROLE_RANK.ADMIN,
  'channel.reorder': ROLE_RANK.ADMIN,
  'member.mute': ROLE_RANK.MODERATOR,
  'member.change-nickname': ROLE_RANK.MODERATOR,
  'member.kick': ROLE_RANK.ADMIN,
  'member.ban': ROLE_RANK.ADMIN,
  'member.change-role': ROLE_RANK.ADMIN,
  'invite.create': ROLE_RANK.MEMBER,
  'invite.revoke': ROLE_RANK.MODERATOR,
  'group.update-meta': ROLE_RANK.ADMIN,
  'group.delete': ROLE_RANK.OWNER,
};

export function can(role: GroupRole | null | undefined, action: GroupAction): boolean {
  if (!role) return false;
  const rank = ROLE_RANK[role];
  const minRank = ACTION_MIN_RANK[action];
  if (minRank === undefined) return false;
  return rank >= minRank;
}

export function isHigherRole(a: GroupRole, b: GroupRole): boolean {
  return ROLE_RANK[a] > ROLE_RANK[b];
}

export function isMuted(member: Pick<StudyGroupMember, 'mutedUntil'>): boolean {
  if (!member.mutedUntil) return false;
  return new Date(member.mutedUntil).getTime() > Date.now();
}

export function denyReason(role: GroupRole | null | undefined, action: GroupAction): string {
  if (!role) return 'Bạn không phải thành viên của group này';
  if (!can(role, action)) {
    return `Vai trò ${role} không có quyền thực hiện hành động này`;
  }
  return '';
}
