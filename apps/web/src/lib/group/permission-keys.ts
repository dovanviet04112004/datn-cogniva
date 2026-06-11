export type PermissionKey =
  | 'manageGroup'
  | 'manageRoles'
  | 'manageChannels'
  | 'viewAuditLog'
  | 'kickMembers'
  | 'banMembers'
  | 'inviteMembers'
  | 'changeNickname'
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
  | 'connect'
  | 'speak'
  | 'video'
  | 'screenShare'
  | 'muteMembers'
  | 'deafenMembers'
  | 'moveMembers'
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
