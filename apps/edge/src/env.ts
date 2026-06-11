export type Env = {
  ORIGIN_URL: string;
  JWKS_URL: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  ENV: 'local' | 'staging' | 'production';

  RATE_LIMIT_DO: DurableObjectNamespace;
  FLAGS_KV: KVNamespace;

  EDGE_SHARED_SECRET?: string;
};

export type Variables = {
  userId: string | null;
  traceId: string;
  country: string | null;
  region: string;
  isAuthenticated: boolean;
};

export type HonoEnv = { Bindings: Env; Variables: Variables };
