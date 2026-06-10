/**
 * Zod schemas /dm/** — copy NGUYÊN từ apps/web/src/app/api/dm/**.
 * dmMessageSchema parse trong service (route cũ check thread 403 TRƯỚC body).
 */
import { z } from 'zod';

export const createDmThreadSchema = z.object({
  peerUserId: z.string().min(1),
});
export type CreateDmThreadInput = z.infer<typeof createDmThreadSchema>;

const ATTACHMENT = z.object({
  type: z.enum(['image', 'file', 'audio', 'video']),
  url: z.string().min(1),
  name: z.string().max(200),
  size: z.number().int().min(0).max(50 * 1024 * 1024),
  mime: z.string().max(100),
});

export const dmMessageSchema = z
  .object({
    content: z.string().max(4000).optional().default(''),
    replyToId: z.string().optional(),
    attachments: z.array(ATTACHMENT).max(10).optional(),
  })
  .refine(
    (d) => (d.content && d.content.trim().length > 0) || (d.attachments && d.attachments.length > 0),
    { message: 'Cần content hoặc attachment', path: ['content'] },
  );
