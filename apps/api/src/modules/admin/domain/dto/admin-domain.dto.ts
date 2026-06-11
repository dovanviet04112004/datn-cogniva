/**
 * Zod schemas cho admin domain routes — body validate giữ y route cũ
 * (reason 10..500 bắt buộc trên mọi mutation có audit).
 */
import { z } from 'zod';

export const adminReasonSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});
export type AdminReasonInput = z.infer<typeof adminReasonSchema>;

export const refundSchema = z.object({
  /** Partial refund; omit = full refund (amountVnd của payment). */
  amountVnd: z.number().int().positive().optional(),
  reason: z.string().trim().min(10).max(500),
});
export type RefundInput = z.infer<typeof refundSchema>;

export const circuitResetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(10).max(500),
});
export type CircuitResetInput = z.infer<typeof circuitResetSchema>;

export const kycReviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(500).optional(),
});
export type KycReviewInput = z.infer<typeof kycReviewSchema>;

/** Clamp limit query param y route cũ: NaN → default, floor, 1..max. */
export function clampLimit(raw: string | undefined, def: number, max: number): number {
  const n = Number(raw ?? def);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n))) : def;
}

/** Cursor ISO → Date; invalid → null (route cũ bỏ qua cursor invalid). */
export function parseCursor(cursor: string | undefined): Date | null {
  if (!cursor) return null;
  const d = new Date(cursor);
  return Number.isNaN(d.getTime()) ? null : d;
}
