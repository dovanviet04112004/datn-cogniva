/**
 * Impersonation marker — Phase 6 V1.
 *
 * Phase 6 V1 KHÔNG swap session. Cookie chỉ đánh dấu "admin X đang
 * impersonate user Y" để:
 *   1. Banner hiển thị nhắc nhở
 *   2. Middleware block mọi mutation (POST/PUT/PATCH/DELETE) → admin không
 *      vô tình thay đổi data của user khi impersonating
 *   3. Audit log ghi start + stop
 *
 * Phase 6.2+ sẽ swap session thật (tạo session mới cho target user, lưu admin
 * session ID để restore). Hiện tại đủ cho safety primitive.
 *
 * Format cookie: base64(JSON) + "." + base64(HMAC-SHA256). Tự verify khi đọc.
 */
import { createHmac, randomUUID } from 'node:crypto';

import { cookies } from 'next/headers';

const COOKIE_NAME = 'cogniva-imp';
const MAX_DURATION_MIN = 60;

/** Secret để sign cookie. Fall back về AUTH_SECRET nếu env riêng chưa set. */
function getSecret(): string {
  return (
    process.env.IMPERSONATION_SECRET ?? process.env.BETTER_AUTH_SECRET ?? 'dev-only'
  );
}

export type ImpersonationPayload = {
  /** Random ID cho audit log correlate start↔stop. */
  sessionId: string;
  adminId: string;
  adminEmail: string;
  targetUserId: string;
  targetEmail: string;
  /** Unix millis. Cookie hết hạn khi quá. */
  expiresAt: number;
  /** 'readonly' V1; 'full' Phase 6.2+. */
  mode: 'readonly' | 'full';
};

function sign(value: string): string {
  return createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function encodeCookie(payload: ImpersonationPayload): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  return `${b64}.${sign(b64)}`;
}

function decodeCookie(value: string): ImpersonationPayload | null {
  const [b64, sig] = value.split('.');
  if (!b64 || !sig) return null;
  if (sign(b64) !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (typeof payload !== 'object' || payload === null) return null;
    if (typeof payload.expiresAt !== 'number' || Date.now() > payload.expiresAt) {
      return null;
    }
    return payload as ImpersonationPayload;
  } catch {
    return null;
  }
}

/**
 * Đọc cookie hiện tại từ request headers. Server component / route handler.
 */
export async function getImpersonation(): Promise<ImpersonationPayload | null> {
  const c = await cookies();
  const raw = c.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return decodeCookie(raw);
}

/**
 * Đọc cookie từ NextRequest (dùng cho middleware).
 */
export function getImpersonationFromRequest(
  cookieValue: string | undefined,
): ImpersonationPayload | null {
  if (!cookieValue) return null;
  return decodeCookie(cookieValue);
}

/**
 * Set cookie impersonation. Caller route đã ghi audit log trước khi gọi.
 */
export async function setImpersonationCookie(
  payload: Omit<ImpersonationPayload, 'sessionId' | 'expiresAt'> & {
    durationMin?: number;
  },
): Promise<ImpersonationPayload> {
  const durationMin = Math.min(MAX_DURATION_MIN, Math.max(5, payload.durationMin ?? 30));
  const expiresAt = Date.now() + durationMin * 60_000;
  const full: ImpersonationPayload = {
    sessionId: randomUUID(),
    adminId: payload.adminId,
    adminEmail: payload.adminEmail,
    targetUserId: payload.targetUserId,
    targetEmail: payload.targetEmail,
    mode: payload.mode,
    expiresAt,
  };
  const c = await cookies();
  c.set(COOKIE_NAME, encodeCookie(full), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: durationMin * 60,
  });
  return full;
}

export async function clearImpersonationCookie(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

export { COOKIE_NAME as IMPERSONATION_COOKIE_NAME };
