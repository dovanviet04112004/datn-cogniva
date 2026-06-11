import { z } from 'zod';

export const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const joinGroupSchema = z.object({
  code: z.string().min(4).max(32),
});
export type JoinGroupInput = z.infer<typeof joinGroupSchema>;

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  iconUrl: z.string().url().nullable().optional(),
  bannerUrl: z.string().url().nullable().optional(),
  maxMembers: z.number().int().min(2).max(10_000).optional(),
  recordingLogChannelId: z.string().nullable().optional(),
});

export const createCategorySchema = z.object({
  name: z.string().min(1).max(80),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  position: z.number().int().min(0).optional(),
});

export const createChannelSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[\p{L}0-9\-_]+$/u, 'Tên chỉ cho phép chữ, số, gạch ngang, gạch dưới'),
  type: z.enum(['TEXT', 'VOICE', 'ANNOUNCEMENT', 'STAGE', 'FORUM']),
  topic: z.string().max(200).optional(),
  voiceMaxParticipants: z.number().int().min(1).max(100).optional(),
});

export const updateChannelSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[\p{L}0-9\-_]+$/u)
    .optional(),
  topic: z.string().max(200).nullable().optional(),
  position: z.number().int().min(0).optional(),
  slowModeSeconds: z.number().int().min(0).max(21600).nullable().optional(),
  voiceMaxParticipants: z.number().int().min(1).max(100).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  availableTags: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        color: z.string().max(20).optional(),
      }),
    )
    .max(20)
    .nullable()
    .optional(),
});

export const reorderChannelsSchema = z.object({
  orders: z
    .array(
      z.object({
        id: z.string().min(1),
        position: z.number().int().min(0).max(10_000),
      }),
    )
    .min(1)
    .max(100),
});

export const createInviteSchema = z.object({
  maxUses: z.number().int().min(1).max(10_000).nullable().optional(),
  expiresInSec: z
    .number()
    .int()
    .min(60)
    .max(60 * 60 * 24 * 30)
    .nullable()
    .optional(),
});

export const updateMemberSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER']).optional(),
  nickname: z.string().max(40).nullable().optional(),
});

const MAX_MUTE_SEC = 60 * 60 * 24 * 7;
export const muteMemberSchema = z.object({
  durationSec: z.number().int().min(30).max(MAX_MUTE_SEC),
});

export const createRoleSchema = z.object({
  name: z.string().min(1).max(50).trim(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#9aa3af'),
  permissions: z.record(z.string(), z.boolean()).default({}),
  hoisted: z.boolean().default(false),
  mentionable: z.boolean().default(false),
});

export const updateRoleSchema = z
  .object({
    name: z.string().min(1).max(50).trim().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    permissions: z.record(z.string(), z.boolean()).optional(),
    hoisted: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    position: z.number().int().min(0).max(95).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Body rỗng' });
