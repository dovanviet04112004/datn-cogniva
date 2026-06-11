export interface ApiConfig {
  baseUrl: string;
  getToken?: () => string | null | Promise<string | null>;
  credentials: 'omit' | 'same-origin' | 'include';
  fetchFn?: typeof fetch;
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
