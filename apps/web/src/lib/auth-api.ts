export type AuthApiResult =
  | { ok: true; twoFactorRequired?: false }
  | { ok: true; twoFactorRequired: true; challengeToken: string }
  | { ok: false; error: string };

export const TWO_FACTOR_CHALLENGE_KEY = 'cogniva.admin.2fa-challenge';

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

export async function signInTwoFactor(
  challengeToken: string,
  code: string,
): Promise<AuthApiResult> {
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

export async function signOut(): Promise<void> {
  await post('/api/auth/sign-out', {}).catch(() => undefined);
}

export async function twoFactorEnable(
  password: string,
): Promise<{ ok: true; totpURI: string; backupCodes: string[] } | { ok: false; error: string }> {
  const { res, data } = await post('/api/auth/2fa/enable', { password });
  if (!res.ok) return { ok: false, error: errorMessage(data, 'Bật 2FA thất bại.') };
  const d = data as { totpURI?: string; backupCodes?: string[] };
  if (!d.totpURI) return { ok: false, error: 'Server không trả totpURI.' };
  return { ok: true, totpURI: d.totpURI, backupCodes: d.backupCodes ?? [] };
}

export async function twoFactorVerify(code: string): Promise<AuthApiResult> {
  const { res, data } = await post('/api/auth/2fa/verify', { code });
  if (!res.ok) return { ok: false, error: errorMessage(data, 'Mã 2FA không đúng.') };
  return { ok: true };
}

export async function twoFactorDisable(password: string): Promise<AuthApiResult> {
  const { res, data } = await post('/api/auth/2fa/disable', { password });
  if (!res.ok) return { ok: false, error: errorMessage(data, 'Tắt 2FA thất bại.') };
  return { ok: true };
}
