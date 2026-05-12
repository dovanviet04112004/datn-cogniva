/**
 * Env binding typings — match wrangler.toml [vars] + [[bindings]] + secrets.
 *
 * Workers KHÔNG có process.env — bindings inject vào `env` argument của handler.
 * Hono pass env vào context: c.env.ORIGIN_URL, c.env.RATE_LIMIT_DO, …
 */

export type Env = {
  // ── Vars (wrangler.toml [vars]) ─────────────────────────────────────
  ORIGIN_URL: string;
  JWKS_URL: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  ENV: 'local' | 'staging' | 'production';

  // ── Bindings ───────────────────────────────────────────────────────
  RATE_LIMIT_DO: DurableObjectNamespace;
  FLAGS_KV: KVNamespace;

  // ── Secrets (.dev.vars hoặc `wrangler secret put`) ─────────────────
  EDGE_SHARED_SECRET?: string;
  BETTER_AUTH_JWT_SECRET?: string;  // optional fallback (HS256)
};

/**
 * Hono ContextVariableMap — biến lưu giữa middleware chain qua c.set/c.get.
 */
export type Variables = {
  /** User id từ JWT (null = guest) */
  userId: string | null;
  /** Trace id propagate qua origin (header x-trace-id) */
  traceId: string;
  /** Country code (ISO 3166-1) từ CF cf-ipcountry header */
  country: string | null;
  /** Region tag (asia/eu/us/etc.) — cho origin route DB replica */
  region: string;
  /** Có phải authenticated user không (đã verify JWT thành công) */
  isAuthenticated: boolean;
};

export type HonoEnv = { Bindings: Env; Variables: Variables };
