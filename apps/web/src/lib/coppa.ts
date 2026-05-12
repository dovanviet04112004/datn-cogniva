/**
 * COPPA — Children's Online Privacy Protection Act compliance helpers.
 *
 * Plan v2 §3.7.2 + §15.1 W9-10.
 *
 * Trách nhiệm:
 *   - Tính tuổi từ DOB
 *   - Quyết định consent status theo age
 *   - Sign/verify JWT token cho parental consent email link
 *   - Check user account có bị limit không (PENDING → gate AI/upload/room)
 *
 * Tuổi minimum:
 *   - 5 tuổi: floor — dưới đó refuse signup
 *   - 13 tuổi: COPPA threshold (US). EU GDPR có thể 16 — Stage 2 split rule.
 *   - 18 tuổi: full adult capacity (relevant cho EU/UK contracts).
 *
 * JWT cho parent consent:
 *   - TTL 7 days (parent có thể không check email ngay)
 *   - Payload: { userId, parentEmail, action, exp }
 *   - Signed bằng JWT_SECRET (cùng key với Hocuspocus + middleware)
 *   - Re-issue được nếu user resend email
 *
 * Limit gate:
 *   - Status PENDING → block AI, upload, room participation, chat
 *   - Status REJECTED → block hết, hiển thị "tài khoản đã bị từ chối"
 *   - Status VERIFIED hoặc NOT_REQUIRED → full functional
 */
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

import { db, user } from '@cogniva/db';

/** COPPA threshold US — dưới đây cần parental consent. */
export const COPPA_AGE_THRESHOLD = 13;

/** Tuổi sàn signup — dưới đây từ chối hoàn toàn (account stranger danger). */
export const MIN_SIGNUP_AGE = 5;

/** Tuổi trần realistic — chống user gõ DOB tương lai hoặc 1800. */
export const MAX_SIGNUP_AGE = 120;

/** JWT TTL cho parent consent token (giây). 7 ngày. */
const CONSENT_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;

/**
 * Tính tuổi tròn năm từ DOB. KHÔNG dùng (Date.now - dob) / yearMs
 * vì sai ở edge case nhuận năm.
 */
export function calculateAge(dob: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/**
 * Validate DOB hợp lệ cho signup.
 * @returns { valid: true, age } hoặc { valid: false, reason }
 */
export function validateDob(
  dob: Date | string,
):
  | { valid: true; age: number }
  | { valid: false; reason: string } {
  const date = typeof dob === 'string' ? new Date(dob) : dob;
  if (Number.isNaN(date.getTime())) {
    return { valid: false, reason: 'Ngày sinh không hợp lệ' };
  }
  if (date.getTime() > Date.now()) {
    return { valid: false, reason: 'Ngày sinh không thể ở tương lai' };
  }
  const age = calculateAge(date);
  if (age < MIN_SIGNUP_AGE) {
    return { valid: false, reason: `Tuổi tối thiểu để dùng Cogniva là ${MIN_SIGNUP_AGE}` };
  }
  if (age > MAX_SIGNUP_AGE) {
    return { valid: false, reason: 'Ngày sinh không hợp lệ' };
  }
  return { valid: true, age };
}

/**
 * Quyết định status ban đầu khi signup.
 *
 * @param age - Tuổi tính từ DOB
 * @param parentEmail - Email cha mẹ (required nếu age < 13)
 */
export function determineConsentStatus(
  age: number,
  parentEmail: string | null,
): {
  status: 'NOT_REQUIRED' | 'PENDING';
  needsParentEmail: boolean;
} {
  if (age >= COPPA_AGE_THRESHOLD) {
    return { status: 'NOT_REQUIRED', needsParentEmail: false };
  }
  // Age < 13 — cần consent
  return {
    status: 'PENDING',
    needsParentEmail: !parentEmail,
  };
}

/**
 * Check user có bị limit không (gate AI/upload/room).
 *
 * @param status - parental_consent_status từ DB
 * @returns true nếu account bị limit, false nếu free để dùng
 */
export function isAccountLimited(status: string): boolean {
  return status === 'PENDING' || status === 'REJECTED';
}

// ────────────────────────────────────────────────────────────
// JWT consent token
// ────────────────────────────────────────────────────────────

export type ConsentTokenPayload = {
  /** ID user con (account bị gate). */
  userId: string;
  /** Email parent đã nhập — verify match khi parent submit. */
  parentEmail: string;
  /** Issued at (iat tự auto từ jsonwebtoken). */
  iat?: number;
  /** Expiry (exp auto từ jsonwebtoken). */
  exp?: number;
};

function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      '[coppa] JWT_SECRET không đủ mạnh (≥32 chars). Set trong .env.local.',
    );
  }
  return secret;
}

/**
 * Sign consent token để embed vào email link.
 *
 *   https://cogniva.app/parental-consent?token={signedToken}
 */
export function signConsentToken(payload: ConsentTokenPayload): string {
  return jwt.sign(
    { userId: payload.userId, parentEmail: payload.parentEmail },
    requireSecret(),
    { expiresIn: CONSENT_TOKEN_TTL_SEC, issuer: 'cogniva', audience: 'parental-consent' },
  );
}

/**
 * Verify token từ URL — throw nếu invalid/expired.
 */
export function verifyConsentToken(token: string): ConsentTokenPayload {
  const decoded = jwt.verify(token, requireSecret(), {
    issuer: 'cogniva',
    audience: 'parental-consent',
  }) as ConsentTokenPayload;
  return decoded;
}

// ────────────────────────────────────────────────────────────
// DB convenience
// ────────────────────────────────────────────────────────────

/**
 * Set consent status cho user — wrap update với audit-friendly fields.
 */
export async function setConsentStatus(args: {
  userId: string;
  status: 'VERIFIED' | 'REJECTED';
}): Promise<void> {
  await db
    .update(user)
    .set({
      parentalConsentStatus: args.status,
      parentalConsentAt: args.status === 'VERIFIED' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(user.id, args.userId));
}

/**
 * Lookup user kèm consent state. Sử dụng cho gate middleware + UI banner.
 */
export async function getUserConsentState(userId: string): Promise<{
  status: string;
  parentEmail: string | null;
  dateOfBirth: Date | null;
  parentalConsentAt: Date | null;
  isLimited: boolean;
} | null> {
  const [row] = await db
    .select({
      status: user.parentalConsentStatus,
      parentEmail: user.parentEmail,
      dateOfBirth: user.dateOfBirth,
      parentalConsentAt: user.parentalConsentAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    isLimited: isAccountLimited(row.status),
  };
}
