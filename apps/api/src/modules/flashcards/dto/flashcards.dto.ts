/**
 * Zod schemas cho /api/flashcards — copy NGUYÊN schema từ route Next cũ
 * (apps/web/src/app/api/flashcards/{route,[id]/review/route,generate/route}.ts)
 * để wire contract (400 = { error: flatten() }) không đổi.
 */
import { z } from 'zod';

/** POST /flashcards — CREATE_SCHEMA cũ. */
export const createFlashcardSchema = z.object({
  cardType: z.enum(['BASIC', 'CLOZE', 'IMAGE_OCCLUSION']),
  front: z.string().min(1).max(5000),
  back: z.string().min(1).max(10000),
  workspaceId: z.string().nullable().optional(),
  conceptId: z.string().optional(),
  sourceChunkId: z.string().optional(),
});
export type CreateFlashcardInput = z.infer<typeof createFlashcardSchema>;

/** POST /flashcards/:id/review — REVIEW_SCHEMA cũ (duration ms = proxy confidence). */
export const reviewFlashcardSchema = z.object({
  rating: z.number().int().min(1).max(4),
  duration: z.number().int().min(0).max(600_000).default(0),
});
export type ReviewFlashcardInput = z.infer<typeof reviewFlashcardSchema>;

/**
 * POST /flashcards/generate — GENERATE_SCHEMA cũ. Validate THỦ CÔNG trong
 * controller (rate-limit chạy trước 400, đúng thứ tự route cũ).
 * coverAll=true → bỏ cap `limit`, phủ HẾT chunk chưa-có-thẻ (tới trần an toàn).
 */
export const generateFlashcardsSchema = z.object({
  documentId: z.string().optional(),
  chunkIds: z.array(z.string()).optional(),
  // ATOM-TARGETED: gen luyện ĐÚNG 1 atom (concept) — resolve chunks của atom đó.
  conceptId: z.string().optional(),
  type: z.enum(['BASIC', 'CLOZE']).default('BASIC'),
  limit: z.number().int().min(1).max(50).default(10),
  coverAll: z.boolean().optional().default(false),
});
export type GenerateFlashcardsInput = z.infer<typeof generateFlashcardsSchema>;
