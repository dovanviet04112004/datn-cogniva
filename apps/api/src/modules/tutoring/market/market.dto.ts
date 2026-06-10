/**
 * Zod schemas dùng qua ZodValidationPipe — copy y schema inline route Next cũ
 * (lỗi 400 {error: flatten()} giữ nguyên shape).
 */
import { z } from 'zod';

/** POST packs/:id/purchase — body { installmentPeriods? 2|3|4, recurringSchedule? }. */
export const PACK_PURCHASE_SCHEMA = z.object({
  installmentPeriods: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  recurringSchedule: z.string().max(50).optional(),
});
export type PackPurchaseInput = z.infer<typeof PACK_PURCHASE_SCHEMA>;

/** POST promo/redeem — body { code }. */
export const PROMO_REDEEM_SCHEMA = z.object({
  code: z.string().min(1).max(50),
});
export type PromoRedeemInput = z.infer<typeof PROMO_REDEEM_SCHEMA>;

/** POST compare — body { tutorIds: 2-4 ids }. */
export const COMPARE_SCHEMA = z.object({
  tutorIds: z.array(z.string().min(1)).min(2).max(4),
});
export type CompareInput = z.infer<typeof COMPARE_SCHEMA>;
