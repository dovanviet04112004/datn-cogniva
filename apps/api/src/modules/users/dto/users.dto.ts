/** Zod schemas — copy NGUYÊN schema từ route cũ để wire contract không đổi. */
import { z } from 'zod';

export const patchProfileSchema = z.object({
  isPublic: z.boolean().optional(),
  name: z.string().min(1).max(100).optional(),
});
export type PatchProfileInput = z.infer<typeof patchProfileSchema>;

const STATUS_ENUM = z.enum(['online', 'idle', 'dnd', 'offline', 'invisible']);

export const putStatusSchema = z
  .object({
    status: STATUS_ENUM.optional(),
    statusText: z.string().max(128).nullable().optional(),
    statusEmoji: z.string().max(8).nullable().optional(),
    /** Số giây tới khi auto-clear status (vd 1800 = 30'). NULL = persist. */
    expiresInSec: z.number().int().min(60).max(60 * 60 * 24 * 7).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Body rỗng' });
export type PutStatusInput = z.infer<typeof putStatusSchema>;
