import { getApiConfig } from './config';

export class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = getApiConfig();
  const fetchFn = cfg.fetchFn ?? fetch;
  const url = /^https?:\/\//.test(path) ? path : `${cfg.baseUrl.replace(/\/$/, '')}${path}`;

  const headers: Record<string, string> = {
    ...cfg.defaultHeaders,
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const token = cfg.getToken ? await cfg.getToken() : null;
  if (token) headers['authorization'] = `Bearer ${token}`;

  const res = await fetchFn(url, {
    ...init,
    headers,
    credentials: cfg.credentials,
  });

  if (!res.ok) {
    let msg = `Lỗi ${res.status}`;
    try {
      const d = (await res.json()) as { error?: string; message?: string };
      msg = d?.error ?? d?.message ?? msg;
    } catch {}
    throw new ApiRequestError(msg, res.status);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, method: 'GET' });
}

export function apiSend<T = unknown>(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return request<T>(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return request<T>(path, { method: 'POST', body: form });
}
