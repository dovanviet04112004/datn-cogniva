import { z } from 'zod';

export const generateQuizSchema = z.object({
  documentId: z.string().optional(),
  chunkIds: z.array(z.string()).optional(),
  conceptId: z.string().optional(),
  types: z
    .array(z.enum(['MCQ', 'TRUE_FALSE', 'SHORT']))
    .optional()
    .default(['MCQ', 'TRUE_FALSE', 'SHORT']),
  count: z.number().int().min(1).max(20).default(10),
  coverAll: z.boolean().optional().default(false),
  title: z.string().min(1).max(200).optional(),
});

export type GenerateQuizInput = z.infer<typeof generateQuizSchema>;

const answerSchema = z.object({
  questionId: z.string(),
  userAnswer: z.union([z.number(), z.boolean(), z.string()]),
});

export const attemptQuizSchema = z.object({
  answers: z.array(answerSchema).min(1).max(50),
});

export type AttemptQuizInput = z.infer<typeof attemptQuizSchema>;

export const gradeQuestionSchema = z.object({
  answer: z.union([z.number(), z.string()]),
});

export type GradeQuestionInput = z.infer<typeof gradeQuestionSchema>;
