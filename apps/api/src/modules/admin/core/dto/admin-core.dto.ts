/**
 * Zod schemas cho AdminCoreModule — giữ NGUYÊN constraint route cũ
 * (apps/web/src/app/api/admin/**): reason chuẩn 10..500, RIÊNG PATCH user
 * min 5 (quirk route cũ, không "sửa" để golden diff khớp).
 */
import { z } from 'zod';

export const adminReasonSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});
export type AdminReasonInput = z.infer<typeof adminReasonSchema>;

export const adminPatchUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  plan: z.enum(['FREE', 'PRO', 'TEAM']).optional(),
  isPublic: z.boolean().optional(),
  reason: z.string().trim().min(5).max(500),
});
export type AdminPatchUserInput = z.infer<typeof adminPatchUserSchema>;

export const impersonateSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().trim().min(10).max(500),
  durationMin: z.number().int().min(5).max(60).optional(),
});
export type ImpersonateInput = z.infer<typeof impersonateSchema>;

/** Tên flag kebab-case max 60 chars — dùng cả cho DELETE query param. */
export const FLAG_NAME = /^[a-z][a-z0-9_-]{0,59}$/;

export const setFlagSchema = z.object({
  name: z.string().regex(FLAG_NAME, 'Tên flag phải kebab-case, max 60 chars'),
  value: z.unknown(),
  reason: z.string().trim().min(10).max(500),
});
export type SetFlagInput = z.infer<typeof setFlagSchema>;

export const setMaintenanceSchema = z.object({
  enabled: z.boolean(),
  banner: z.string().trim().max(500).nullable().optional(),
  dismissible: z.boolean().optional(),
  reason: z.string().trim().min(10).max(500),
});
export type SetMaintenanceInput = z.infer<typeof setMaintenanceSchema>;

export const resolveReportSchema = z.object({
  resolution: z.enum(['dismiss', 'takedown', 'warn', 'ban']),
  reason: z.string().trim().min(10).max(500),
});
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
