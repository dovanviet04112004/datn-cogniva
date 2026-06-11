import { z } from 'zod';

export const createRoomSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['STUDY', 'CLASSROOM', 'EXAM', 'OFFICE_HOURS']).default('STUDY'),
  visibility: z.enum(['PRIVATE', 'UNLISTED', 'PUBLIC']).default('UNLISTED'),
  maxMembers: z.number().int().min(2).max(50).default(10),
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const joinRoomSchema = z.object({
  code: z.string().min(4).max(20),
});

export const roomTokenSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
});
export type RoomTokenInput = z.infer<typeof roomTokenSchema>;

export const collabTokenSchema = z.object({
  kind: z.enum(['whiteboard', 'notes', 'code']),
});

export const chatMessageSchema = z.object({
  content: z.string().min(1).max(2000),
  type: z.enum(['TEXT', 'FILE', 'AI']).default('TEXT'),
  metadata: z.record(z.unknown()).optional(),
});

export const aiMessageSchema = z.object({
  message: z.string().min(1).max(2000),
});

export const moderateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('KICK'), targetUserId: z.string() }),
  z.object({ action: z.literal('MUTE'), targetUserId: z.string() }),
  z.object({ action: z.literal('UNMUTE_REQUEST'), targetUserId: z.string() }),
  z.object({ action: z.literal('LOCK'), locked: z.boolean() }),
  z.object({ action: z.literal('APPROVE'), targetUserId: z.string() }),
  z.object({ action: z.literal('REJECT'), targetUserId: z.string() }),
  z.object({ action: z.literal('PROMOTE'), targetUserId: z.string() }),
  z.object({ action: z.literal('DEMOTE'), targetUserId: z.string() }),
]);
export type ModerateInput = z.infer<typeof moderateSchema>;
