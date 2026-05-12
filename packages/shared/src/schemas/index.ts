/**
 * Zod schemas share giữa web + mobile cho request validation.
 *
 * Web: dùng ở route handler input parse (z.parse() body).
 * Mobile: dùng ở form validation trước khi gọi API (consistency).
 */
import { z } from 'zod';

// ── Auth ──────────────────────────────────────────────────────────
export const signUpSchema = z
  .object({
    email: z.string().email('Email không hợp lệ'),
    password: z
      .string()
      .min(8, 'Mật khẩu tối thiểu 8 ký tự')
      .max(128, 'Mật khẩu quá dài'),
    confirmPassword: z.string(),
    name: z.string().min(1, 'Tên không được rỗng').max(80).optional(),
    dateOfBirth: z.string().datetime().optional(),
    parentEmail: z.string().email().optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirmPassword'],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(1, 'Mật khẩu bắt buộc'),
});

export type SignInInput = z.infer<typeof signInSchema>;

// ── Document upload ───────────────────────────────────────────────
export const documentMetaSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

// ── Flashcard review ──────────────────────────────────────────────
export const reviewRatingSchema = z.object({
  flashcardId: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

// ── Chat ──────────────────────────────────────────────────────────
export const chatSendSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(8000),
  documentIds: z.array(z.string()).max(20).optional(),
});
