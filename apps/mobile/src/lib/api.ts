/**
 * API client singleton cho mobile — JWT stack NestJS.
 *
 * Wrapper trên `@cogniva/shared/api`. Inject:
 *   - baseUrl từ EXPO_PUBLIC_API_URL
 *   - Bearer accessToken (JWT ES256, sống 15') từ SecureStore
 *   - fetchWithRefresh: request 401 → refresh MỘT lần → retry với token mới
 *
 * Refresh rotation: POST /api/auth/refresh {refreshToken} → cặp token MỚI,
 * token cũ bị revoke (reuse detection revoke cả family nếu xài lại token cũ)
 * → nhiều request 401 đồng thời PHẢI share 1 promise refresh, không đua nhau.
 *
 * Refresh fail phân biệt 2 trường hợp:
 *   - Server từ chối (4xx: revoked/expired/reuse) → phiên chết hẳn → clear
 *     storage + báo store về signed-out.
 *   - Lỗi mạng (fetch throw) → GIỮ token, thử lại sau — đừng đăng xuất oan
 *     user đang offline.
 */
import Constants from 'expo-constants';
import { createApiClient, configureApi, type UserDTO } from '@cogniva/shared';

import {
  clearAllAuthStorage,
  refreshStorage,
  saveTokenPair,
  tokenStorage,
  userCache,
} from './storage';

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const defaultHeaders = {
  'x-client-name': 'cogniva-mobile',
  'x-client-version': Constants.expoConfig?.version ?? '0.1.0',
  'x-client-platform': Constants.platform?.ios ? 'ios' : 'android',
};

// ── Refresh rotation ──────────────────────────────────────────────

let onAuthLost: (() => void) | null = null;

/** store/auth.ts đăng ký callback set user=null khi phiên chết giữa chừng —
 *  dùng callback thay vì import store để tránh import vòng (store → api). */
export function setOnAuthLost(cb: () => void): void {
  onAuthLost = cb;
}

let refreshing: Promise<string | null> | null = null;

/** Mutex đơn giản: mọi caller trong lúc đang refresh share cùng 1 promise. */
function refreshAccessToken(): Promise<string | null> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = await refreshStorage.get();
  if (!refreshToken) return null;

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json', ...defaultHeaders },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return null; // lỗi mạng — giữ nguyên token, lần gọi sau thử lại
  }

  if (!res.ok) {
    // 4xx = server từ chối hẳn (revoked/expired/reuse) → phiên chết.
    // 5xx = server lỗi tạm — giữ token, lần sau thử lại.
    if (res.status >= 400 && res.status < 500) {
      await clearAllAuthStorage();
      onAuthLost?.();
    }
    return null;
  }

  const data = (await res.json().catch(() => null)) as {
    user?: UserDTO;
    accessToken?: string;
    refreshToken?: string;
  } | null;
  if (!data?.accessToken || !data.refreshToken) return null;

  await saveTokenPair(data.accessToken, data.refreshToken);
  if (data.user) await userCache.set(data.user);
  return data.accessToken;
}

/** Đọc `exp` (ms epoch) từ payload JWT — null nếu không decode được. */
function jwtExpiresAt(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload || typeof atob !== 'function') return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const exp = (JSON.parse(atob(padded)) as { exp?: number }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Access token CÒN HẠN cho consumer tự gắn header (realtime handshake, upload
 * FormData…): sắp/đã hết hạn (<30s) → refresh trước rồi mới trả. Gateway
 * realtime verify JWT cục bộ nên token hết hạn là handshake rớt ngay.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const token = await tokenStorage.get();
  if (!token) return null;
  const exp = jwtExpiresAt(token);
  if (exp !== null && exp - Date.now() < 30_000) {
    return (await refreshAccessToken()) ?? (await tokenStorage.get());
  }
  return token;
}

/**
 * fetch có refresh-retry: 401 → refresh (mutex share) → retry request gốc
 * ĐÚNG 1 LẦN với Bearer mới (retry dùng fetch thường → không đệ quy).
 * /api/auth/refresh không bao giờ đi qua đây (doRefresh gọi fetch thẳng).
 */
const fetchWithRefresh: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;

  const newToken = await refreshAccessToken();
  if (!newToken) return res; // refresh fail — trả 401 gốc cho caller xử lý

  const headers = {
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
    authorization: `Bearer ${newToken}`,
  };
  return fetch(input, { ...init, headers });
};

// ── Client ────────────────────────────────────────────────────────

export const api = createApiClient({
  baseUrl: apiUrl,
  getToken: () => tokenStorage.get(),
  fetchFn: fetchWithRefresh,
  // Mobile: omit cookie — Bearer là cơ chế auth duy nhất. RN auto-persist
  // cookie từ Set-Cookie response → leak cookie vào request sau.
  credentials: 'omit',
  defaultHeaders,
});

// Cấu hình fetcher React-Query DÙNG CHUNG (@cogniva/shared/api: apiGet/apiSend) để
// các query-option factory share giữa web + mobile chạy đúng trên mobile. Cùng
// nguồn baseUrl/token/headers/fetchFn với createApiClient ở trên → không lệch nhau.
configureApi({
  baseUrl: apiUrl,
  getToken: () => tokenStorage.get(),
  fetchFn: fetchWithRefresh,
  credentials: 'omit',
  defaultHeaders,
});
