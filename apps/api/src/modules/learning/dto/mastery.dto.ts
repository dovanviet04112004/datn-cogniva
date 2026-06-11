import { z } from 'zod';

export const markMasterySchema = z.object({
  conceptId: z.string(),
  level: z.enum(['new', 'learning', 'mastered']),
  workspaceId: z.string().optional(),
});
export type MarkMasteryInput = z.infer<typeof markMasterySchema>;
