/**
 * Auth store — Zustand. Lưu user state in-memory + hydrate từ SecureStore.
 *
 * Token strategy (auth V2 — NestJS, xem docs/plans/nestjs-migration.md §3):
 *   1. Sign-in/sign-up gọi endpoint MỚI /api/auth/sign-in|sign-up (NestJS qua
 *      proxy cùng origin). Server dual-issue: response vẫn có header
 *      `set-auth-token` = session token ký HMAC (format `token.signature`)
 *      y hệt Better Auth → mobile lưu làm Bearer như cũ.
 *   2. Bearer này được CẢ 2 hệ chấp nhận: route Next cũ (Better Auth bearer
 *      plugin) lẫn route NestJS mới (nhánh legacy của AuthGuard) — mobile
 *      không phải đổi gì thêm trong suốt migration.
 *   3. Khi 270 route port xong (cuối GĐ1) mobile sẽ chuyển hẳn sang cặp
 *      accessToken/refreshToken JWT (đã có sẵn trong response body).
 */
import { create } from 'zustand';
import type { UserDTO } from '@cogniva/shared';

import { api } from '@/lib/api';
import {
  clearAllAuthStorage,
  tokenStorage,
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

/** Xử lý response sign-in/sign-up: lưu token (header set-auth-token) + user. */
async function captureAuth(res: Response): Promise<UserDTO> {
  const data = (await res.json()) as {
    user: UserDTO;
    twoFactorRequired?: boolean;
  };
  if (data.twoFactorRequired) {
    // UI nhập TOTP trên mobile chưa có — user 2FA đăng nhập trên web trước.
    throw new Error('Tài khoản bật 2FA — vui lòng đăng nhập trên web.');
  }
  const sessionToken = res.headers.get('set-auth-token');
  if (sessionToken) await tokenStorage.set(sessionToken);
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
      // Re-validate qua API — token expired/invalid → null → bắt sign-in lại.
      const result = await api.auth.session();
      if (result.ok && result.data && result.data.user) {
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
      await api.auth.signOut();
    } catch {
      // Ignore — vẫn clear local state dù API fail.
    }
    await clearAllAuthStorage();
    set({ user: null, busy: false });
  },
}));
