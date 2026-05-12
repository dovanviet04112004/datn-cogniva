/**
 * Auth store — Zustand. Lưu user state in-memory + hydrate từ SecureStore.
 *
 * Token strategy (Stage 2 M4 W4):
 *   1. Sign-in/sign-up trả `set-auth-token` header = session token (signed
 *      HMAC bởi BETTER_AUTH_SECRET, format `sessionId.signature`).
 *   2. Mobile lưu session token vào SecureStore.
 *   3. Mobile gửi `Authorization: Bearer <session_token>` cho mọi API call.
 *   4. Better Auth bearer plugin verify HMAC → session context OK.
 *   5. Edge gateway forward Authorization header nguyên vẹn về origin.
 *
 * Tại sao KHÔNG dùng JWT làm primary bearer:
 *   - Better Auth bearer plugin chỉ verify session signature, KHÔNG hiểu JWT.
 *   - JWT vẫn dùng được — qua endpoint /api/auth/token mint khi cần (vd
 *     cho 3rd party như Supabase/Hasura, hoặc edge verify offline).
 *   - Cho Stage 2 M4 W4: session token là đủ. Edge JWT verify wire khi nào
 *     cần per-user rate limit ở edge KHÔNG round-trip origin (Stage 2 M5+).
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

/**
 * Mint JWT từ session token — KHÔNG dùng cho bearer auth origin (bearer
 * plugin chỉ verify session signature, không hiểu JWT format).
 *
 * Use cases ở các stage sau:
 *   - Edge gateway verify JWT offline qua JWKS (Stage 2 M5+ khi production)
 *   - 3rd party services (Supabase RLS, Hasura permissions)
 *   - Offline payload reading (mobile decode plan/email từ JWT mà không API call)
 *
 * Hiện tại export để test endpoint, không gọi tự động trong sign-in/sign-up.
 */
export async function mintJwt(sessionToken: string): Promise<string | null> {
  try {
    const url = `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/auth/token`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}

interface AuthState {
  user: UserDTO | null;
  hydrating: boolean;
  busy: boolean;
  error: string | null;

  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    password: string;
    name?: string;
    dateOfBirth?: string;     // ISO YYYY-MM-DD
    parentEmail?: string;     // bắt buộc nếu age < 13
  }) => Promise<void>;
  signOut: () => Promise<void>;
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
      // Re-validate qua API — Better Auth trả `null` khi token expired/invalid,
      // `{ session, user }` khi valid. Guard cả 2 case.
      const result = await api.auth.session();
      if (result.ok && result.data && result.data.user) {
        set({ user: result.data.user, hydrating: false });
        await userCache.set(result.data.user);
        return;
      }
      // Token expired hoặc invalid → clear storage, user phải sign-in lại
      await clearAllAuthStorage();
    }
    set({ user: null, hydrating: false });
  },

  signIn: async (email, password) => {
    set({ busy: true, error: null });
    const url = `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/auth/sign-in/email`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        // KHÔNG gửi cookie — mobile dùng bearer token, không cookie. RN có
        // thể persist cookie từ response trước (credentials: include) → mỗi
        // fetch sau auto attach Cookie header → Better Auth bearer plugin
        // inject cookie context → origin-check fire → 403. `omit` chặn flow này.
        credentials: 'omit',
        headers: {
          'content-type': 'application/json',
          // BẮT BUỘC — header này trigger Better Auth mobile-origin-inject
          // plugin set synthetic Origin để pass CSRF origin-check. Web KHÔNG
          // gửi header này, vẫn full origin-check protection.
          'x-client-name': 'cogniva-mobile',
        },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string | { message?: string };
        };
        const msg =
          typeof body.error === 'string'
            ? body.error
            : body.error?.message ?? body.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const data = (await res.json()) as {
        token?: string;
        user: UserDTO;
      };
      // Capture session token từ header `set-auth-token` hoặc body.
      // Đây là bearer token chính — origin Better Auth bearer plugin verify.
      // Ưu tiên header `set-auth-token` (format `sessionId.signature`).
      // body.token chỉ chứa sessionId thuần — bearer plugin với requireSignature:true
      // sẽ reject vì thiếu HMAC signature → 401 ở mọi API call sau sign-in.
      const sessionToken = res.headers.get('set-auth-token') ?? data.token;
      if (sessionToken) await tokenStorage.set(sessionToken);
      await userCache.set(data.user);
      set({ user: data.user, busy: false });
    } catch (err) {
      set({
        busy: false,
        error: err instanceof Error ? err.message : 'Sign in failed',
      });
      throw err;
    }
  },

  signUp: async (input) => {
    set({ busy: true, error: null });
    const url = `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/auth/sign-up/email`;
    try {
      // Better Auth additionalFields: dateOfBirth + parentEmail pass thẳng vào
      // user.create hook (xem apps/web/src/lib/auth.ts). KHÔNG cần tách body.
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'omit', // KHÔNG attach cookie (xem signIn comment)
        headers: {
          'content-type': 'application/json',
          'x-client-name': 'cogniva-mobile',
        },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          name: input.name,
          dateOfBirth: input.dateOfBirth,
          parentEmail: input.parentEmail,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string | { message?: string };
        };
        const msg =
          typeof body.error === 'string'
            ? body.error
            : body.error?.message ?? body.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const data = (await res.json()) as {
        token?: string;
        user: UserDTO;
      };
      // Ưu tiên header `set-auth-token` (format `sessionId.signature`).
      // body.token chỉ chứa sessionId thuần — bearer plugin với requireSignature:true
      // sẽ reject vì thiếu HMAC signature → 401 ở mọi API call sau sign-in.
      const sessionToken = res.headers.get('set-auth-token') ?? data.token;
      if (sessionToken) await tokenStorage.set(sessionToken);
      await userCache.set(data.user);
      set({ user: data.user, busy: false });
    } catch (err) {
      set({
        busy: false,
        error: err instanceof Error ? err.message : 'Sign up failed',
      });
      throw err;
    }
  },

  signOut: async () => {
    set({ busy: true });
    // M7: unregister push token TRƯỚC khi sign-out — backend cần Bearer còn
    // hợp lệ để verify ownership trước khi xoá. Nếu không có token cached
    // (device chưa register push), skip silent.
    try {
      const cachedToken = getCachedPushToken();
      if (cachedToken) {
        await api.account.unregisterPushToken(cachedToken);
      }
    } catch {
      // Ignore — sign-out vẫn tiếp tục dù unregister fail (token sẽ stale, cron
      // dọn sau khi Expo Push API trả `DeviceNotRegistered`)
    }
    try {
      await api.auth.signOut();
    } catch {
      // Ignore — vẫn clear local state dù API fail
    }
    await clearAllAuthStorage();
    set({ user: null, busy: false });
  },
}));
