import { z } from 'zod';

export const createStudyPlanSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  conceptId: z.string().optional(),
  dueDate: z.string().datetime().optional(),
});
export type CreateStudyPlanInput = z.infer<typeof createStudyPlanSchema>;

export const patchStudyPlanSchema = z.object({
  status: z.enum(['PENDING', 'DONE']).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  dueDate: z.string().datetime().nullable().optional(),
});
export type PatchStudyPlanInput = z.infer<typeof patchStudyPlanSchema>;
