/**
 * Client auth V2 — gọi endpoint NestJS mới (/api/auth/* qua proxy cùng origin,
 * xem next.config.mjs NEST_EXACT_PATHS). Thay dần Better Auth client.
 *
 * Server set 3 cookie httpOnly: cg_at (JWT 15'), cg_rt (refresh 30d) và
 * better-auth.session_token (DUAL-ISSUE — SSR cũ vẫn nhận user). Client chỉ
 * cần đọc body để biết kết quả; không tự quản token.
 */

export type AuthApiResult =
  | { ok: true; twoFactorRequired?: false }
  | { ok: true; twoFactorRequired: true; challengeToken: string }
  | { ok: false; error: string };

/** Rút message dễ đọc từ shape lỗi {error: string | zodFlatten}. */
function errorMessage(body: unknown, fallback: string): string {
  const err = (body as { error?: unknown })?.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const fieldErrors = (err as { fieldErrors?: Record<string, string[]> }).fieldErrors;
    const first = fieldErrors && Object.values(fieldErrors).flat()[0];
    if (first) return first;
  }
  return fallback;
}

async function post(path: string, body: unknown): Promise<{ res: Response; data: unknown }> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, data: await res.json().catch(() => ({})) };
}

export async function signIn(email: string, password: string): Promise<AuthApiResult> {
  const { res, data } = await post('/api/auth/sign-in', { email, password });
  if (!res.ok) return { ok: false, error: errorMessage(data, 'Đăng nhập thất bại.') };
  const d = data as { twoFactorRequired?: boolean; challengeToken?: string };
  if (d.twoFactorRequired && d.challengeToken) {
    return { ok: true, twoFactorRequired: true, challengeToken: d.challengeToken };
  }
  return { ok: true };
}

export async function signInTwoFactor(challengeToken: string, code: string): Promise<AuthApiResult> {
  const { res, data } = await post('/api/auth/sign-in/2fa', { challengeToken, code });
  if (!res.ok) return { ok: false, error: errorMessage(data, 'Mã 2FA không đúng.') };
  return { ok: true };
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthApiResult> {
  const { res, data } = await post('/api/auth/sign-up', input);
  if (!res.ok) return { ok: false, error: errorMessage(data, 'Không tạo được tài khoản.') };
  return { ok: true };
}

/** Sign-out cả 2 hệ (refresh family + session Better Auth) — server xử lý. */
export async function signOut(): Promise<void> {
  await post('/api/auth/sign-out', {}).catch(() => undefined);
}
