/**
 * API client singleton cho mobile.
 *
 * Wrapper trên `@cogniva/shared/api`. Inject:
 *   - baseUrl từ EXPO_PUBLIC_API_URL
 *   - bearer token từ SecureStore
 *   - default header User-Agent (cho phân tích traffic mobile vs web)
 *
 * Mobile KHÔNG có cookie tự động — phải dùng JWT Bearer token. Stage 2 M4 W3
 * sẽ wire Better Auth JWT plugin để mobile lấy được token sau khi login.
 */
import Constants from 'expo-constants';
import { createApiClient } from '@cogniva/shared';

import { tokenStorage } from './storage';

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const api = createApiClient({
  baseUrl: apiUrl,
  getToken: () => tokenStorage.get(),
  // Mobile: omit cookie. Bearer token là cơ chế auth duy nhất. RN auto-persist
  // cookie từ Set-Cookie response → leak cookie vào request sau → trigger
  // bearer plugin → origin-check 403.
  credentials: 'omit',
  defaultHeaders: {
    'x-client-name': 'cogniva-mobile',
    'x-client-version': Constants.expoConfig?.version ?? '0.1.0',
    'x-client-platform': Constants.platform?.ios ? 'ios' : 'android',
  },
});
