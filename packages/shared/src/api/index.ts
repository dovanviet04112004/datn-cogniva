import type {
  ApiResult,
  ApiError,
  DocumentDTO,
  FlashcardDTO,
  ReviewDTO,
  UsageDTO,
  UserDTO,
  ChatMessageDTO,
} from '../types';

export interface ApiClientConfig {
  baseUrl: string;
  getToken?: () => string | null | Promise<string | null>;
  fetchFn?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  credentials?: 'omit' | 'same-origin' | 'include';
}

class ApiClient {
  constructor(private cfg: ApiClientConfig) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    const fetchFn = this.cfg.fetchFn ?? fetch;
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}${path}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...this.cfg.defaultHeaders,
      ...((init.headers as Record<string, string>) ?? {}),
    };
    const token = this.cfg.getToken ? await this.cfg.getToken() : null;
    if (token) headers['authorization'] = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetchFn(url, {
        ...init,
        headers,
        credentials: this.cfg.credentials ?? 'include',
      });
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'network_error',
          message: err instanceof Error ? err.message : 'Network error',
        },
      };
    }

    if (!res.ok) {
      let error: ApiError = {
        code: `http_${res.status}`,
        message: res.statusText,
      };
      try {
        const body = (await res.json()) as Partial<ApiError> & {
          error?: ApiError | string;
        };
        if (body.error) {
          error =
            typeof body.error === 'string'
              ? { code: error.code, message: body.error }
              : (body.error as ApiError);
        } else if (body.message) {
          error.message = body.message;
        }
      } catch {}
      return { ok: false, error };
    }

    try {
      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'parse_error',
          message: err instanceof Error ? err.message : 'JSON parse error',
        },
      };
    }
  }

  auth = {
    me: () => this.req<{ user: UserDTO }>('/api/auth/me'),
    signOut: (refreshToken?: string) =>
      this.req<{ ok: true }>('/api/auth/sign-out', {
        method: 'POST',
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      }),
  };

  account = {
    usage: () => this.req<UsageDTO>('/api/account/usage'),
    export: () => this.req<{ url: string }>('/api/account/export', { method: 'POST' }),
    deleteStatus: () =>
      this.req<
        | { pending: false }
        | {
            pending: true;
            requestId: string;
            scheduledFor: string;
            daysRemaining: number;
            canCancel: boolean;
          }
      >('/api/account/delete'),
    requestDelete: (reason?: string) =>
      this.req<{ scheduledFor: string }>('/api/account/delete', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'DELETE MY ACCOUNT', reason }),
      }),
    cancelDelete: () => this.req<{ ok: true }>('/api/account/delete', { method: 'DELETE' }),
    registerPushToken: (input: {
      token: string;
      platform: 'ios' | 'android' | 'web';
      deviceId?: string;
    }) =>
      this.req<{ ok: true; action: 'created' | 'updated' | 'transferred' }>(
        '/api/account/push-token',
        { method: 'POST', body: JSON.stringify(input) },
      ),
    unregisterPushToken: (token: string) =>
      this.req<{ ok: true; removed: number }>('/api/account/push-token', {
        method: 'DELETE',
        body: JSON.stringify({ token }),
      }),
  };

  documents = {
    list: () => this.req<{ documents: DocumentDTO[] }>('/api/documents'),
    get: (id: string) => this.req<DocumentDTO>(`/api/documents/${id}`),
  };

  flashcards = {
    listDue: (limit = 20) =>
      this.req<{ flashcards: FlashcardDTO[] }>(`/api/flashcards/queue?limit=${limit}`),
    review: (input: { flashcardId: string; rating: 1 | 2 | 3 | 4; duration?: number }) =>
      this.req<{ flashcard: FlashcardDTO; review: ReviewDTO }>(
        `/api/flashcards/${input.flashcardId}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ rating: input.rating, duration: input.duration ?? 0 }),
        },
      ),
  };

  chat = {
    send: (input: { conversationId?: string; message: string; documentIds?: string[] }) =>
      this.req<ChatMessageDTO>('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  };
}

export function createApiClient(cfg: ApiClientConfig): ApiClient {
  return new ApiClient(cfg);
}

export type { ApiClient };

export * from './config';
export * from './rq-fetcher';
