import { z } from 'zod';

export const annotationBodySchema = z.object({
  pageNum: z.number().int().min(1).max(10000),
  note: z.string().min(2).max(2000),
  visibility: z.enum(['public', 'private']).default('public'),
  selectedText: z.string().max(500).optional(),
  selectionRect: z
    .object({
      pageW: z.number(),
      pageH: z.number(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    })
    .optional(),
});

export const savedSearchBodySchema = z.object({
  name: z.string().min(2).max(80),
  queryParams: z.record(z.union([z.string(), z.number(), z.array(z.string())])),
  notifyOnNew: z.boolean().optional().default(false),
});
