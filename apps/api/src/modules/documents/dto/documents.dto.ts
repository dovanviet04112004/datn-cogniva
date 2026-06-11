import { z } from 'zod';

export const moveDocumentSchema = z.object({
  workspaceId: z.string(),
});
export type MoveDocumentInput = z.infer<typeof moveDocumentSchema>;
