import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'cogniva.auth_token';
const REFRESH_KEY = 'cogniva.refresh_token';
const USER_KEY = 'cogniva.user_cache';

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

export async function saveTokenPair(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([tokenStorage.set(accessToken), refreshStorage.set(refreshToken)]);
}

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
  set: <T>(value: T) => SecureStore.setItemAsync(USER_KEY, JSON.stringify(value)),
  clear: () => SecureStore.deleteItemAsync(USER_KEY),
};

export async function clearAllAuthStorage(): Promise<void> {
  await Promise.allSettled([tokenStorage.clear(), refreshStorage.clear(), userCache.clear()]);
}
