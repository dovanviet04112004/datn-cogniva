/**
 * Zod schemas account/* — port NGUYÊN từ apps/web/src/app/api/account/
 * (delete/route.ts + push-token/route.ts). Message tiếng Việt giữ nguyên byte.
 */
import { z } from 'zod';

export const deleteAccountSchema = z.object({
  reason: z.string().max(500).optional(),
  /** Confirm typed value để chống misclick. Required = "DELETE MY ACCOUNT". */
  confirm: z.string().refine((s) => s === 'DELETE MY ACCOUNT', {
    message: 'Phải gõ chính xác "DELETE MY ACCOUNT" để confirm',
  }),
});

export const registerPushTokenSchema = z.object({
  /** Expo format: `ExponentPushToken[xxx]` ~ 40-50 chars */
  token: z
    .string()
    .min(10)
    .max(200)
    .refine((s) => /^(ExponentPushToken\[|ExpoPushToken\[)/.test(s), {
      message: 'Token phải format Expo Push Token',
    }),
  platform: z.enum(['ios', 'android', 'web']),
  deviceId: z.string().max(200).optional(),
});

export const deletePushTokenSchema = z.object({
  token: z.string().min(10).max(200),
});

export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
export type DeletePushTokenInput = z.infer<typeof deletePushTokenSchema>;
