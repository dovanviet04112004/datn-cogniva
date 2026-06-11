/**
 * Auth store — Zustand. Lưu user state in-memory + hydrate từ SecureStore.
 *
 * Token strategy (JWT stack NestJS — xem docs/plans/nestjs-migration.md §3):
 *   - Sign-in/sign-up trả CẶP token trong BODY: accessToken (JWT ES256, 15')
 *     + refreshToken (opaque 30d, rotation) → lưu SecureStore.
 *   - Mọi API gắn `Authorization: Bearer <accessToken>`; hết hạn thì
 *     lib/api.ts tự refresh + retry (xem fetchWithRefresh).
 *   - Header `set-auth-token` (session Better Auth cũ) KHÔNG dùng nữa —
 *     backend sắp gỡ dual-accept, token BA sẽ bị 401.
 */
import { create } from 'zustand';
import type { UserDTO } from '@cogniva/shared';

import { api, setOnAuthLost } from '@/lib/api';
import {
  clearAllAuthStorage,
  refreshStorage,
  saveTokenPair,
  userCache,
} from '@/lib/storage';
import { getCachedPushToken } from '@/lib/notifications';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

interface AuthState {
  user: UserDTO | null;
  hydrating: boolean;
  busy: boolean;
  error: string | null;

  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { email: string; password: string; name?: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

/** Rút message từ shape lỗi {error: string | zodFlatten} của API V2. */
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

/** POST auth endpoint — credentials omit (mobile không cookie, chỉ Bearer). */
async function postAuth(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'content-type': 'application/json',
      'x-client-name': 'cogniva-mobile',
    },
    body: JSON.stringify(body),
  });
}

/** Xử lý response sign-in/sign-up: lưu cặp JWT (từ BODY) + user cache. */
async function captureAuth(res: Response): Promise<UserDTO> {
  const data = (await res.json()) as {
    user: UserDTO;
    accessToken?: string;
    refreshToken?: string;
    twoFactorRequired?: boolean;
  };
  if (data.twoFactorRequired) {
    // UI nhập TOTP trên mobile chưa có — user 2FA đăng nhập trên web trước.
    throw new Error('Tài khoản bật 2FA — vui lòng đăng nhập trên web.');
  }
  if (!data.accessToken || !data.refreshToken) {
    throw new Error('Server không trả token — vui lòng thử lại.');
  }
  await saveTokenPair(data.accessToken, data.refreshToken);
  await userCache.set(data.user);
  return data.user;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  hydrating: true,
  busy: false,
  error: null,

  hydrate: async () => {
    set({ hydrating: true });
    const cached = await userCache.get<UserDTO>();
    if (cached) {
      // Re-validate qua /api/auth/me — accessToken hết hạn thì fetchWithRefresh
      // tự refresh+retry; refresh cũng fail → signed-out, bắt sign-in lại.
      const result = await api.auth.me();
      if (result.ok && result.data?.user) {
        set({ user: result.data.user, hydrating: false });
        await userCache.set(result.data.user);
        return;
      }
      await clearAllAuthStorage();
    }
    set({ user: null, hydrating: false });
  },

  signIn: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const res = await postAuth('/api/auth/sign-in', { email, password });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(errorMessage(body, `HTTP ${res.status}`));
      }
      const user = await captureAuth(res);
      set({ user, busy: false });
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : 'Sign in failed' });
      throw err;
    }
  },

  signUp: async (input) => {
    set({ busy: true, error: null });
    try {
      const res = await postAuth('/api/auth/sign-up', {
        email: input.email,
        password: input.password,
        name: input.name,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(errorMessage(body, `HTTP ${res.status}`));
      }
      const user = await captureAuth(res);
      set({ user, busy: false });
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : 'Sign up failed' });
      throw err;
    }
  },

  signOut: async () => {
    set({ busy: true });
    // M7: unregister push token TRƯỚC khi sign-out — backend cần Bearer còn
    // hợp lệ để verify ownership. Không có token cached → skip silent.
    try {
      const cachedToken = getCachedPushToken();
      if (cachedToken) {
        await api.account.unregisterPushToken(cachedToken);
      }
    } catch {
      // Ignore — token stale sẽ được cron dọn khi Expo trả DeviceNotRegistered.
    }
    try {
      // Gửi refreshToken trong body để server revoke đúng phiên này.
      const refreshToken = await refreshStorage.get();
      await api.auth.signOut(refreshToken ?? undefined);
    } catch {
      // Ignore — vẫn clear local state dù API fail.
    }
    await clearAllAuthStorage();
    set({ user: null, busy: false });
  },
}));

// Refresh token bị server từ chối giữa chừng (revoked/reuse-detected) →
// lib/api.ts đã clear storage, đẩy UI về signed-out ngay không đợi hydrate.
setOnAuthLost(() => useAuth.setState({ user: null }));
