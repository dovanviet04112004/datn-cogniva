/**
 * Zod schemas ExamsModule — copy NGUYÊN VĂN từ route Next cũ
 * (apps/web/src/app/api/exams/** + /api/attempts/**) để body 400
 * `{ error: flatten() }` byte-identical.
 *
 * LƯU Ý thứ tự validate: nhiều route cũ parse body SAU các check
 * 404/403/409 (vd PUT /exams/[id]) — những schema đó được service tự
 * safeParse thay vì đi qua ZodValidationPipe (pipe chạy trước handler
 * sẽ đảo thứ tự status code).
 */
import { z } from 'zod';

export const createExamSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  workspaceId: z.string().nullable().optional(),
  mode: z.enum(['PRACTICE', 'TIMED']).default('PRACTICE'),
  durationSeconds: z.number().int().positive().optional(),
  passingScore: z.number().min(0).max(1).optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  allowReview: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  showResults: z.enum(['IMMEDIATE', 'AFTER_SUBMIT', 'AFTER_ALL_DONE']).optional(),
});
export type CreateExamInput = z.infer<typeof createExamSchema>;

export const updateExamSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  mode: z.enum(['PRACTICE', 'TIMED']).optional(),
  durationSeconds: z.number().int().positive().nullable().optional(),
  /** ISO timestamp — đồng loạt start time (TIMED proctored exam). NULL = student tự bấm. */
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  passingScore: z.number().min(0).max(1).nullable().optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  allowReview: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  showResults: z.enum(['IMMEDIATE', 'AFTER_SUBMIT', 'AFTER_ALL_DONE']).optional(),
  /** Phase 19 — anti-cheat config jsonb. */
  antiCheat: z.object({
    requireFullscreen: z.boolean().optional(),
    blockTabSwitch: z.boolean().optional(),
    blockCopyPaste: z.boolean().optional(),
    blockContextMenu: z.boolean().optional(),
    detectDevtools: z.boolean().optional(),
    requireWebcam: z.boolean().optional(),
    requireMic: z.boolean().optional(),
    aiProctor: z.boolean().optional(),
  }).optional(),
});

export const joinExamSchema = z.object({ code: z.string().min(4).max(12) });

export const generateQuestionsSchema = z.object({
  documentId: z.string().optional(),
  chunkIds: z.array(z.string()).optional(),
  types: z
    .array(z.enum(['MCQ', 'TRUE_FALSE', 'SHORT']))
    .optional()
    .default(['MCQ', 'TRUE_FALSE', 'SHORT']),
  count: z.number().int().min(1).max(30).default(10),
});

export const createQuestionSchema = z.object({
  type: z.enum([
    'MCQ_SINGLE',
    'MCQ_MULTI',
    'TRUE_FALSE',
    'SHORT',
    'ESSAY',
    'FILL_BLANK',
    'MATCHING',
    'ORDERING',
    'CODE',
    'MATH',
    'DRAWING',
  ]),
  prompt: z.string().min(1).max(5000),
  promptHtml: z.string().max(20_000).optional(),
  attachments: z
    .array(
      z.object({
        type: z.string(),
        url: z.string().url(),
        alt: z.string().optional(),
      }),
    )
    .optional(),
  options: z.union([
    z.array(z.string()),
    z.record(z.string(), z.string()),
    z.null(),
  ]).optional(),
  correctAnswer: z.unknown().optional(),
  acceptableAnswers: z.array(z.string()).optional(),
  rubric: z.unknown().optional(),
  points: z.number().positive().max(1000).default(1),
  partialCredit: z.boolean().optional(),
  conceptId: z.string().optional(),
  explanation: z.string().max(5000).optional(),
  hint: z.string().max(1000).optional(),
  timeLimitSeconds: z.number().int().positive().max(3600).optional(),
});

export const updateQuestionSchema = z.object({
  prompt: z.string().min(1).max(5000).optional(),
  promptHtml: z.string().max(20_000).nullable().optional(),
  options: z.unknown().optional(),
  correctAnswer: z.unknown().optional(),
  acceptableAnswers: z.array(z.string()).nullable().optional(),
  rubric: z.unknown().optional(),
  points: z.number().positive().max(1000).optional(),
  partialCredit: z.boolean().optional(),
  explanation: z.string().max(5000).nullable().optional(),
  hint: z.string().max(1000).nullable().optional(),
  timeLimitSeconds: z.number().int().positive().max(3600).nullable().optional(),
  orderIndex: z.number().int().min(0).optional(),
});

export const saveResponseSchema = z.object({
  questionId: z.string(),
  answer: z.unknown(),
  responseTimeMs: z.number().int().min(0).optional(),
});

const violationEventSchema = z.object({
  type: z.string().max(50),
  severity: z.enum(['low', 'medium', 'high']),
  timestamp: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const violationsBodySchema = z.object({
  events: z.array(violationEventSchema).max(50),
});
