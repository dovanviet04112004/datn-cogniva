import { z } from 'zod';

export const zPresenceState = z.object({
  channel: z.string(),
  userIds: z.array(z.string()),
});
export const zPresenceMember = z.object({
  channel: z.string(),
  userId: z.string(),
});
export type PresenceState = z.infer<typeof zPresenceState>;
export type PresenceMember = z.infer<typeof zPresenceMember>;

export const zTyping = z.object({
  userId: z.string(),
  name: z.string(),
  image: z.string().nullish(),
  expiresAt: z.number(),
});
export type TypingPayload = z.infer<typeof zTyping>;

export const zStatusChange = z.object({
  userId: z.string(),
  status: z.enum(['online', 'idle', 'dnd', 'offline', 'invisible']),
  statusText: z.string().nullish(),
  statusEmoji: z.string().nullish(),
});
export type StatusChangePayload = z.infer<typeof zStatusChange>;

export const zVoiceState = z.object({
  selfMuted: z.boolean(),
  serverMuted: z.boolean(),
  camera: z.boolean(),
  screenShare: z.boolean(),
});
export const zVoiceJoin = zVoiceState.extend({
  userId: z.string(),
  name: z.string().nullish(),
  image: z.string().nullish(),
});
export const zVoiceStateChanged = zVoiceState.extend({ userId: z.string() });
export type VoiceJoinPayload = z.infer<typeof zVoiceJoin>;
export type VoiceStateChangedPayload = z.infer<typeof zVoiceStateChanged>;
