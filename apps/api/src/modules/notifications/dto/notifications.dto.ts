import { z } from 'zod';

export const markReadSchema = z
  .object({
    ids: z.array(z.string()).max(100).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => !!v.ids?.length || v.all === true, {
    message: 'Cần truyền ids hoặc all=true',
  });

export type MarkReadInput = z.infer<typeof markReadSchema>;

export const REPORT_TARGET_TYPES = [
  'group_message',
  'ai_message',
  'user',
  'document',
  'group',
  'conversation',
] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().min(1).max(200),
  reason: z.string().trim().min(10).max(1000),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
