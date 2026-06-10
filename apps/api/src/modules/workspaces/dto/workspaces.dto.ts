/**
 * Zod schemas — copy NGUYÊN từ route cũ apps/web/src/app/api/workspaces
 * (CREATE_SCHEMA / PATCH_SCHEMA) để 400 flatten() byte-identical.
 */
import { z } from 'zod';

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
