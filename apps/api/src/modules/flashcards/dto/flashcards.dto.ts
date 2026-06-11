import { z } from 'zod';

export const createFlashcardSchema = z.object({
  cardType: z.enum(['BASIC', 'CLOZE', 'IMAGE_OCCLUSION']),
  front: z.string().min(1).max(5000),
  back: z.string().min(1).max(10000),
  workspaceId: z.string().nullable().optional(),
  conceptId: z.string().optional(),
  sourceChunkId: z.string().optional(),
});
export type CreateFlashcardInput = z.infer<typeof createFlashcardSchema>;

export const reviewFlashcardSchema = z.object({
  rating: z.number().int().min(1).max(4),
  duration: z.number().int().min(0).max(600_000).default(0),
});
export type ReviewFlashcardInput = z.infer<typeof reviewFlashcardSchema>;

export const generateFlashcardsSchema = z.object({
  documentId: z.string().optional(),
  chunkIds: z.array(z.string()).optional(),
  conceptId: z.string().optional(),
  type: z.enum(['BASIC', 'CLOZE']).default('BASIC'),
  limit: z.number().int().min(1).max(50).default(10),
  coverAll: z.boolean().optional().default(false),
});
export type GenerateFlashcardsInput = z.infer<typeof generateFlashcardsSchema>;
