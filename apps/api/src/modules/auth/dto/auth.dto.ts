/**
 * Zod schemas cho AuthController — validate qua ZodValidationPipe, lỗi trả
 * `{ error: flatten() }`. (COPPA đã bị cắt khỏi scope 2026-06-10 → sign-up
 * không yêu cầu dateOfBirth/parentEmail.)
 */
import { z } from 'zod';

export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});
export type SignInInput = z.infer<typeof signInSchema>;

/** refreshToken optional — web gửi qua cookie `cg_rt`, mobile gửi qua body. */
export const refreshSchema = z.object({
  refreshToken: z.string().min(20).optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const twoFactorSchema = z.object({
  challengeToken: z.string().min(20),
  code: z.string().regex(/^\d{6}$/, 'Mã 2FA gồm 6 chữ số'),
});
export type TwoFactorInput = z.infer<typeof twoFactorSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(128),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
