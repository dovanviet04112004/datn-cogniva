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

let onAuthLost: (() => void) | null = null;

export function setOnAuthLost(cb: () => void): void {
  onAuthLost = cb;
}

let refreshing: Promise<string | null> | null = null;

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
    return null;
  }

  if (!res.ok) {
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

export async function getValidAccessToken(): Promise<string | null> {
  const token = await tokenStorage.get();
  if (!token) return null;
  const exp = jwtExpiresAt(token);
  if (exp !== null && exp - Date.now() < 30_000) {
    return (await refreshAccessToken()) ?? (await tokenStorage.get());
  }
  return token;
}

const fetchWithRefresh: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;

  const newToken = await refreshAccessToken();
  if (!newToken) return res;

  const headers = {
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
    authorization: `Bearer ${newToken}`,
  };
  return fetch(input, { ...init, headers });
};

export const api = createApiClient({
  baseUrl: apiUrl,
  getToken: () => tokenStorage.get(),
  fetchFn: fetchWithRefresh,
  credentials: 'omit',
  defaultHeaders,
});

configureApi({
  baseUrl: apiUrl,
  getToken: () => tokenStorage.get(),
  fetchFn: fetchWithRefresh,
  credentials: 'omit',
  defaultHeaders,
});
