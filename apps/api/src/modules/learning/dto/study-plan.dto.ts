/**
 * Zod schemas cho /api/study-plan — copy NGUYÊN schema từ route Next cũ
 * (apps/web/src/app/api/study-plan/{route,[id]/route}.ts).
 */
import { z } from 'zod';

/** POST /study-plan — tạo item manual. dueDate = ISO datetime (frontend convert từ input date). */
export const createStudyPlanSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  conceptId: z.string().optional(),
  dueDate: z.string().datetime().optional(),
});
export type CreateStudyPlanInput = z.infer<typeof createStudyPlanSchema>;

/** PATCH /study-plan/:id — toggle status / sửa title/description/dueDate. */
export const patchStudyPlanSchema = z.object({
  status: z.enum(['PENDING', 'DONE']).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  dueDate: z.string().datetime().nullable().optional(),
});
export type PatchStudyPlanInput = z.infer<typeof patchStudyPlanSchema>;
