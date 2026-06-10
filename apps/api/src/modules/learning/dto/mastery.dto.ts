/** Zod schemas mastery — copy NGUYÊN schema từ route Next cũ để wire contract không đổi. */
import { z } from 'zod';

/** POST /mastery/mark — đánh dấu thủ công trạng thái học 1 atom (concept). */
export const markMasterySchema = z.object({
  conceptId: z.string(),
  // 'new' = chưa học (xoá mastery), 'learning' = đang học, 'mastered' = đã nắm.
  level: z.enum(['new', 'learning', 'mastered']),
  workspaceId: z.string().optional(),
});
export type MarkMasteryInput = z.infer<typeof markMasterySchema>;
