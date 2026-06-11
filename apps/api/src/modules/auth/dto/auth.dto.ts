/**
 * Zod schemas cho AuthController — validate qua ZodValidationPipe, lỗi trả
 * `{ error: flatten() }`. (COPPA đã bị cắt khỏi scope 2026-06-10 → sign-up
 * không yêu cầu dateOfBirth/parentEmail.)
 */
import { z } from 'zod';

export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  // Optional (mobile cho phép bỏ trống) — service fallback local-part của email.
  name: z.string().trim().min(1).max(100).optional(),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});
export type SignInInput = z.infer<typeof signInSchema>;

/** refreshToken optional — web gửi qua cookie `cg_rt`, mobile gửi qua body. */
// .default({}): web silent-refresh POST cookie-only không gửi body (express
// không parse → undefined) — vẫn hợp lệ, token lấy từ cookie cg_rt.
export const refreshSchema = z
  .object({
    refreshToken: z.string().min(20).optional(),
  })
  .default({});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const twoFactorSchema = z.object({
  challengeToken: z.string().min(20),
  // 6 số TOTP hoặc backup code xxxxx-xxxxx (1 lần — thay verifyBackupCode BA).
  code: z
    .string()
    .trim()
    .regex(/^(\d{6}|[a-z0-9]{5}-[a-z0-9]{5})$/i, 'Mã 2FA gồm 6 chữ số hoặc backup code'),
});
export type TwoFactorInput = z.infer<typeof twoFactorSchema>;

export const twoFactorPasswordSchema = z.object({
  password: z.string().min(1),
});
export const twoFactorCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Mã 2FA gồm 6 chữ số'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(128),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
