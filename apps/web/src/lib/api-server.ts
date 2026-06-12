import { cookies } from 'next/headers';

const NEST_ORIGIN = process.env.NEST_API_ORIGIN ?? 'http://localhost:4000';

export class ApiServerError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiServerError';
    this.status = status;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const jar = await cookies();
  const token = jar.get('cg_at')?.value;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function apiServer<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${NEST_ORIGIN}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...((init.headers as Record<string, string>) ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    let msg = `Lỗi ${res.status}`;
    try {
      const d = (await res.json()) as { error?: string; message?: string };
      msg = d?.error ?? d?.message ?? msg;
    } catch {}
    throw new ApiServerError(msg, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiServerOrNull<T>(path: string): Promise<T | null> {
  try {
    return await apiServer<T>(path);
  } catch (err) {
    if (
      err instanceof ApiServerError &&
      (err.status === 401 || err.status === 403 || err.status === 404)
    ) {
      return null;
    }
    throw err;
  }
}
