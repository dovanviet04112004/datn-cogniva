import type {
  study_group as StudyGroupRow,
  study_group_category as CategoryRow,
  study_group_channel as ChannelRow,
  study_group_invite as InviteRow,
  study_group_member as MemberRow,
  study_group_role as RoleRow,
} from '@prisma/client';

export function toGroupDto(row: StudyGroupRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerUserId: row.owner_user_id,
    inviteCode: row.invite_code,
    iconUrl: row.icon_url,
    bannerUrl: row.banner_url,
    isPublic: row.is_public,
    maxMembers: row.max_members,
    recordingLogChannelId: row.recording_log_channel_id,
    suspendedAt: row.suspended_at,
    suspendReason: row.suspend_reason,
    createdAt: row.created_at,
  };
}

export function toMemberDto(row: MemberRow) {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: row.joined_at,
    nickname: row.nickname,
    mutedUntil: row.muted_until,
    lastSeenAt: row.last_seen_at,
  };
}

export function toCategoryDto(row: CategoryRow) {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    position: row.position,
    createdAt: row.created_at,
  };
}

export function toChannelDto(row: ChannelRow) {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    type: row.type,
    topic: row.topic,
    position: row.position,
    isPrivate: row.is_private,
    slowModeSeconds: row.slow_mode_seconds,
    createdBy: row.created_by,
    createdAt: row.created_at,
    livekitRoomName: row.livekit_room_name,
    voiceMaxParticipants: row.voice_max_participants,
    categoryId: row.category_id,
    availableTags: row.available_tags,
  };
}

export function toInviteDto(row: InviteRow) {
  return {
    id: row.id,
    groupId: row.group_id,
    code: row.code,
    createdBy: row.created_by,
    maxUses: row.max_uses,
    usesCount: row.uses_count,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function toRoleDto(row: RoleRow) {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    color: row.color,
    position: row.position,
    permissions: row.permissions,
    hoisted: row.hoisted,
    mentionable: row.mentionable,
    isManaged: row.is_managed,
    legacyRole: row.legacy_role,
    createdAt: row.created_at,
  };
}
