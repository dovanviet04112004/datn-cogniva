/**
 * Fetcher tối giản cho React Query — dùng chung web + mobile.
 *
 * Khác `createApiClient` (Result-style ApiResult<T> không throw, method-per-endpoint),
 * fetcher này NÉM lỗi khi !ok → khớp model của React Query (queryFn/mutationFn throw
 * → vào trạng thái error). Gọi theo URL nên scale cho hàng trăm endpoint mà không cần
 * khai báo method từng cái.
 *
 *   - apiGet<T>(path)               → queryFn
 *   - apiSend<T>(path, method, body)→ mutationFn (POST/PUT/PATCH/DELETE JSON)
 *   - apiUpload<T>(path, FormData)  → upload file (không set content-type)
 *
 * baseUrl + auth + credentials lấy từ getApiConfig() (configureApi ở app).
 * Path tuyệt đối (http...) được dùng nguyên, path tương đối ghép baseUrl.
 */
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
  const url = /^https?:\/\//.test(path)
    ? path
    : `${cfg.baseUrl.replace(/\/$/, '')}${path}`;

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
    } catch {
      /* body không phải JSON */
    }
    throw new ApiRequestError(msg, res.status);
  }

  // Một số endpoint trả 204/empty body.
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
