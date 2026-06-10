/**
 * Zod schemas cho /api/notes — copy NGUYÊN schema từ route Next cũ
 * (apps/web/src/app/api/notes/{route,[id]/route,complete/route}.ts)
 * để wire contract (400 = { error: flatten() }) không đổi.
 */
import { z } from 'zod';

/** POST /notes — CREATE_SCHEMA cũ (title/content có default → body {} vẫn hợp lệ). */
export const createNoteSchema = z.object({
  title: z.string().min(1).max(200).default('Untitled'),
  content: z.string().default(''),
  workspaceId: z.string().nullable().optional(),
  conceptId: z.string().optional(),
  documentId: z.string().optional(),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

/** PATCH /notes/:id — UPDATE_SCHEMA cũ (partial, field thiếu giữ nguyên giá trị cũ). */
export const updateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
});
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

/** POST /notes/complete — prefix = text gần cursor (~500 ký tự cuối dùng thật). */
export const completeNoteSchema = z.object({
  prefix: z.string().min(1).max(4000),
});
export type CompleteNoteInput = z.infer<typeof completeNoteSchema>;
