/**
 * Secure storage wrapper — Expo SecureStore (iOS Keychain / Android KeyStore).
 *
 * Lưu token bearer ở đây thay vì AsyncStorage vì SecureStore mã hoá ở mức HĐH:
 *   - iOS: Keychain (Secure Enclave nếu device support)
 *   - Android: KeyStore (TEE / StrongBox)
 *
 * Quota: ~2KB per key — đủ cho JWT + refresh token. KHÔNG dùng cho data lớn.
 */
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'cogniva.auth_token';
const REFRESH_KEY = 'cogniva.refresh_token';
const USER_KEY = 'cogniva.user_cache'; // JSON UserDTO

export const tokenStorage = {
  get: () => SecureStore.getItemAsync(TOKEN_KEY),
  set: (value: string) => SecureStore.setItemAsync(TOKEN_KEY, value),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY),
};

export const refreshStorage = {
  get: () => SecureStore.getItemAsync(REFRESH_KEY),
  set: (value: string) => SecureStore.setItemAsync(REFRESH_KEY, value),
  clear: () => SecureStore.deleteItemAsync(REFRESH_KEY),
};

export const userCache = {
  get: async <T>(): Promise<T | null> => {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  set: <T>(value: T) =>
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(value)),
  clear: () => SecureStore.deleteItemAsync(USER_KEY),
};

/** Clear toàn bộ — gọi khi sign out hoặc account delete confirm. */
export async function clearAllAuthStorage(): Promise<void> {
  await Promise.allSettled([
    tokenStorage.clear(),
    refreshStorage.clear(),
    userCache.clear(),
  ]);
}
