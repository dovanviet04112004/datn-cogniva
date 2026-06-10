/**
 * Zod schemas cho /quiz — copy NGUYÊN VĂN từ route cũ
 * (apps/web/src/app/api/quiz/{generate,[id]/attempt}/route.ts) để 400 flatten
 * byte-identical.
 */
import { z } from 'zod';

export const generateQuizSchema = z.object({
  documentId: z.string().optional(),
  chunkIds: z.array(z.string()).optional(),
  // ATOM-TARGETED: gen quiz ĐÚNG 1 atom (concept) — resolve chunks của atom đó.
  conceptId: z.string().optional(),
  types: z
    .array(z.enum(['MCQ', 'TRUE_FALSE', 'SHORT']))
    .optional()
    .default(['MCQ', 'TRUE_FALSE', 'SHORT']),
  count: z.number().int().min(1).max(20).default(10),
  // coverAll=true → bỏ cap `count`, phủ HẾT chunk của atom. Studio bật cờ này.
  coverAll: z.boolean().optional().default(false),
  title: z.string().min(1).max(200).optional(),
});

export type GenerateQuizInput = z.infer<typeof generateQuizSchema>;

const answerSchema = z.object({
  questionId: z.string(),
  /** Discriminated: MCQ=number, TRUE_FALSE=boolean, SHORT=string. */
  userAnswer: z.union([z.number(), z.boolean(), z.string()]),
});

export const attemptQuizSchema = z.object({
  answers: z.array(answerSchema).min(1).max(50),
});

export type AttemptQuizInput = z.infer<typeof attemptQuizSchema>;
