import { z } from 'zod';

export const createNoteSchema = z.object({
  title: z.string().min(1).max(200).default('Untitled'),
  content: z.string().default(''),
  workspaceId: z.string().nullable().optional(),
  conceptId: z.string().optional(),
  documentId: z.string().optional(),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
});
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

export const completeNoteSchema = z.object({
  prefix: z.string().min(1).max(4000),
});
export type CompleteNoteInput = z.infer<typeof completeNoteSchema>;
