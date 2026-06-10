/**
 * Permission keys + types — V2 G1 client-safe constants.
 *
 * Tách khỏi `effective-permissions.ts` để client component (Settings UI) import
 * được mà không kéo theo DB driver (postgres → fs Node-only). File này
 * KHÔNG được import DB hay any Node-only module.
 */

/**
 * 27 permission key Discord-style — general / membership / text / voice / stage.
 * Source of truth: bất kỳ chỗ nào cần list permission đều import từ đây.
 */
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
