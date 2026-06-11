import { z } from 'zod';

const attachmentSchema = z.object({
  type: z.enum(['image', 'file', 'audio', 'video']),
  url: z.string().min(1),
  name: z.string().max(200),
  size: z
    .number()
    .int()
    .min(0)
    .max(50 * 1024 * 1024),
  mime: z.string().max(100),
});

export const postMessageSchema = z
  .object({
    content: z.string().max(4000).optional().default(''),
    replyToId: z.string().optional(),
    attachments: z.array(attachmentSchema).max(10).optional(),
    mentions: z
      .array(
        z.object({
          type: z.enum(['user', 'channel', 'everyone']),
          id: z.string(),
        }),
      )
      .max(20)
      .optional(),
    title: z.string().min(1).max(200).optional(),
    tags: z.array(z.string().min(1).max(40)).max(5).optional(),
  })
  .refine(
    (d) =>
      (d.content && d.content.trim().length > 0) || (d.attachments && d.attachments.length > 0),
    { message: 'Cần content hoặc attachment', path: ['content'] },
  );

export const editMessageSchema = z.object({
  content: z.string().min(1).max(4000),
});

export const reactSchema = z.object({
  emoji: z.string().min(1).max(16),
});

export const solutionSchema = z.object({
  mark: z.boolean(),
});
export type SolutionInput = z.infer<typeof solutionSchema>;

export const threadReplySchema = z
  .object({
    content: z.string().max(4000).optional().default(''),
    attachments: z.array(attachmentSchema).max(10).optional(),
  })
  .refine(
    (d) =>
      (d.content && d.content.trim().length > 0) || (d.attachments && d.attachments.length > 0),
    { message: 'Cần content hoặc attachment', path: ['content'] },
  );

export const markReadSchema = z.object({
  lastMessageId: z.string().min(1),
});

export const notificationSettingSchema = z.object({
  setting: z.enum(['all', 'mentions', 'none']),
});

export const aiReplySchema = z.object({
  originalMessageId: z.string().min(1),
  prompt: z.string().min(1).max(4000),
});
