/**
 * Cấu hình API dùng chung cho fetcher React-Query (web + mobile).
 *
 * Web: baseUrl = '' (URL tương đối /api/*) + credentials 'include' (cookie Better Auth).
 * Mobile (RN/Expo): baseUrl tuyệt đối (https://host) + getToken trả Bearer JWT +
 *   credentials 'omit' (không gửi cookie — tránh origin-check 403).
 *
 * App gọi `configureApi(...)` 1 lần lúc khởi động. Web có thể bỏ qua vì default
 * (baseUrl '' + credentials 'include') đã đúng.
 */

export interface ApiConfig {
  /** Tiền tố URL. Web: '' (relative). Mobile: 'https://api.cogniva.com'. */
  baseUrl: string;
  /** Trả Bearer token để gắn header Authorization (mobile). Null = không gắn. */
  getToken?: () => string | null | Promise<string | null>;
  /** Cookie policy. Web: 'include'. Mobile: 'omit'. (Literal union — shared lib
   *  dùng @types/node, không có global DOM `RequestCredentials`.) */
  credentials: 'omit' | 'same-origin' | 'include';
  /** Override fetch (test mock / RN polyfill). */
  fetchFn?: typeof fetch;
  /** Header mặc định mỗi request (tracing…). */
  defaultHeaders?: Record<string, string>;
}

let config: ApiConfig = {
  baseUrl: '',
  credentials: 'include',
};

export function configureApi(partial: Partial<ApiConfig>): void {
  config = { ...config, ...partial };
}

export function getApiConfig(): ApiConfig {
  return config;
}
