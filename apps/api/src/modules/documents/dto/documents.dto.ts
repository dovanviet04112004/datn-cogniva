/**
 * Zod schemas documents — copy NGUYÊN từ route Next cũ
 * (apps/web/src/app/api/documents/[id]/move/route.ts).
 */
import { z } from 'zod';

export const moveDocumentSchema = z.object({
  workspaceId: z.string(),
});
export type MoveDocumentInput = z.infer<typeof moveDocumentSchema>;
