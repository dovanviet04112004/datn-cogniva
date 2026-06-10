/**
 * @cogniva/shared/api — fetch-based REST client.
 *
 * Platform agnostic: web (Next.js client component + server route) lẫn mobile
 * (React Native Hermes) đều dùng được. Chỉ phụ thuộc global `fetch` (web standard,
 * RN polyfill sẵn).
 *
 * Auth strategy:
 *   - Web: cookie auto-attach (credentials: 'include')
 *   - Mobile: explicit Authorization header (Bearer JWT) — client tự inject
 *
 * Usage:
 *   const client = createApiClient({ baseUrl: 'https://api.cogniva.com', getToken: () => storage.get('jwt') });
 *   const result = await client.documents.list();
 *   if (result.ok) console.log(result.data);
 */
import type {
  ApiResult,
  ApiError,
  DocumentDTO,
  FlashcardDTO,
  ReviewDTO,
  SessionDTO,
  UsageDTO,
  ChatMessageDTO,
} from '../types';

export interface ApiClientConfig {
  baseUrl: string;
  /** Trả về JWT bearer token. Trả null = không attach. */
  getToken?: () => string | null | Promise<string | null>;
  /** Override fetch (test mock, RN polyfill custom). */
  fetchFn?: typeof fetch;
  /** Headers thêm mỗi request (tracing, user agent, …). */
  defaultHeaders?: Record<string, string>;
  /**
   * Cookie policy.
   *   - 'include' (default cho web): cookie tự attach trong cùng origin
   *   - 'omit'    (recommend cho mobile RN): KHÔNG attach cookie, dùng bearer
   *     RN tự persist cookies giữa request → vô tình gửi cookie tới backend →
   *     Better Auth bearer plugin inject cookie context → origin-check 403.
   */
  credentials?: 'omit' | 'same-origin' | 'include';
}

class ApiClient {
  constructor(private cfg: ApiClientConfig) {}

  private async req<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<ApiResult<T>> {
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
      } catch {
        // body không phải JSON — giữ default
      }
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

  // ── Auth ────────────────────────────────────────────────────────
  auth = {
    // Better Auth trả `null` khi token invalid → SessionDTO | null
    session: () => this.req<SessionDTO | null>('/api/auth/get-session'),
    signOut: () => this.req<{ ok: true }>('/api/auth/sign-out', { method: 'POST' }),
  };

  // ── Account ─────────────────────────────────────────────────────
  account = {
    usage: () => this.req<UsageDTO>('/api/account/usage'),
    export: () => this.req<{ url: string }>('/api/account/export', { method: 'POST' }),
    /** GET trạng thái deletion. `pending: false` nếu không có; ngược lại có scheduledFor + daysRemaining. */
    deleteStatus: () =>
      this.req<
        | { pending: false }
        | { pending: true; requestId: string; scheduledFor: string; daysRemaining: number; canCancel: boolean }
      >('/api/account/delete'),
    /** Backend require body `{ confirm: "DELETE MY ACCOUNT", reason? }` chống misclick. */
    requestDelete: (reason?: string) =>
      this.req<{ scheduledFor: string }>('/api/account/delete', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'DELETE MY ACCOUNT', reason }),
      }),
    cancelDelete: () =>
      this.req<{ ok: true }>('/api/account/delete', { method: 'DELETE' }),
    /**
     * Đăng ký Expo Push Token cho user hiện tại (Stage 2 M7).
     * Backend upsert theo `token` (UNIQUE) — gọi mỗi lần app khởi động
     * cũng OK, chỉ bump `lastSeenAt`.
     */
    registerPushToken: (input: {
      token: string;
      platform: 'ios' | 'android' | 'web';
      deviceId?: string;
    }) =>
      this.req<{ ok: true; action: 'created' | 'updated' | 'transferred' }>(
        '/api/account/push-token',
        { method: 'POST', body: JSON.stringify(input) },
      ),
    /** Unregister 1 token cụ thể (sign-out 1 device). */
    unregisterPushToken: (token: string) =>
      this.req<{ ok: true; removed: number }>('/api/account/push-token', {
        method: 'DELETE',
        body: JSON.stringify({ token }),
      }),
  };

  // ── Documents ───────────────────────────────────────────────────
  documents = {
    list: () => this.req<{ documents: DocumentDTO[] }>('/api/documents'),
    get: (id: string) => this.req<DocumentDTO>(`/api/documents/${id}`),
  };

  // ── Flashcards ──────────────────────────────────────────────────
  flashcards = {
    listDue: (limit = 20) =>
      this.req<{ flashcards: FlashcardDTO[] }>(`/api/flashcards/queue?limit=${limit}`),
    /**
     * POST /api/flashcards/{id}/review — body { rating, duration? }
     * Backend trả về { flashcard, review } sau khi apply FSRS + log.
     */
    review: (input: { flashcardId: string; rating: 1 | 2 | 3 | 4; duration?: number }) =>
      this.req<{ flashcard: FlashcardDTO; review: ReviewDTO }>(
        `/api/flashcards/${input.flashcardId}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ rating: input.rating, duration: input.duration ?? 0 }),
        },
      ),
  };

  // ── Chat ────────────────────────────────────────────────────────
  chat = {
    /** Non-streaming: trả full message; streaming dùng EventSource ở consumer. */
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

// Fetcher tối giản cho React Query (throw on error) + config base-URL/auth.
export * from './config';
export * from './rq-fetcher';
