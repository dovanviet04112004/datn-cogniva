# @cogniva/edge — Cloudflare Workers Gateway

Stage 2 (M4-M5) — Edge gateway in front of Vercel origin.

## Mục đích

Workers chạy ở > 300 PoP toàn cầu (Anycast). Trước khi request chạm Vercel, edge làm:

| Step | Middleware | Mục đích |
|---|---|---|
| 1 | `trace` | Gen / reuse `x-trace-id` end-to-end |
| 2 | `geo` | CF country → region tag → origin chọn DB replica |
| 3 | `jwtVerify` | Verify Better Auth JWT (JWKS), extract `userId` |
| 4 | `csrf` | Double-submit cookie cho POST/PUT/PATCH/DELETE |
| 5 | `rateLimit` | Token bucket per user/IP qua Durable Object |
| 6 | `featureFlags` | Eval flag từ KV, set `x-cogniva-flags` header |
| 7 | `proxyToOrigin` | Forward tới Vercel với headers enriched |

**Hit rate target:** 60% static cache hit, < 50ms JWT verify global, < 250ms p95 cho API regional.

## Architecture

```
client ──► CF PoP (Workers) ──► Vercel origin (Next.js)
            │                       │
            ├ JWT verify             ├ Server components
            ├ Rate limit (DO)        ├ AI streaming
            ├ Geo route              ├ DB writes
            ├ CSRF                   └ Mutations
            └ Feature flags
```

## Local dev

```bash
# Cài deps (root)
pnpm install

# Copy secret stub
cp apps/edge/.dev.vars.example apps/edge/.dev.vars

# Chạy wrangler dev (port 8787)
pnpm --filter @cogniva/edge dev
```

Wrangler dev emulate Workers runtime LOCAL — DO + KV in-memory, không cần CF account.

Sau khi chạy:
- `http://localhost:8787/__edge/health` → JSON health
- `http://localhost:8787/*` → proxy tới `http://localhost:3000` (Next.js)

Để test full stack: chạy đồng thời `pnpm dev:web` ở terminal khác.

## Bindings reference

| Binding | Type | Mục đích |
|---|---|---|
| `RATE_LIMIT_DO` | Durable Object | Token bucket per user/IP |
| `FLAGS_KV` | KV namespace | Feature flag config (eventually consistent) |
| `ORIGIN_URL` | Var | URL Vercel origin (forward target) |
| `JWKS_URL` | Var | Better Auth JWKS endpoint cho RSA verify |
| `JWT_ISSUER` / `JWT_AUDIENCE` | Var | Match Better Auth JWT plugin |
| `EDGE_SHARED_SECRET` | Secret | Anti-bypass marker (origin check header) |

## Deploy

### Lần đầu

```bash
# 1. Login CF
npx wrangler login

# 2. Tạo KV namespace (production)
npx wrangler kv namespace create FLAGS_KV
# → paste id vào wrangler.toml [[kv_namespaces]]

# 3. Set secrets
npx wrangler secret put EDGE_SHARED_SECRET

# 4. Update wrangler.toml account_id + routes (sau khi mua domain)

# 5. Deploy
pnpm --filter @cogniva/edge deploy
```

### CI/CD (Stage 2 W3+)

Add GitHub Action với `cloudflare/wrangler-action@v3`. CF API token cần permission:
- Account: Workers Scripts:Edit
- Zone: Workers Routes:Edit (nếu dùng custom domain)

## Required Better Auth setup (origin side)

Để edge JWT verify hoạt động, `apps/web/src/lib/auth.ts` cần wire JWT plugin:

```ts
import { jwt } from 'better-auth/plugins';

plugins: [
  nextCookies(),
  jwt({
    jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } },
    jwt: {
      issuer: 'cogniva',
      audience: 'cogniva-app',
      expirationTime: '15m',
    },
  }),
],
```

JWT plugin tự expose `/api/auth/jwks` endpoint → edge fetch + cache 1h.

**KHÔNG có JWT plugin** = edge sẽ fail JWT verify cho mọi request (userId luôn null, rate limit fallback IP). Origin vẫn validate session qua DB-backed cookie → KHÔNG bị broken, chỉ mất edge benefits.

→ Wire JWT plugin là acceptance criteria của M4 W3.

## Anti-bypass (anti-DDoS direct hit Vercel)

Khi deploy production, Vercel project KHÔNG nên expose public URL. Setup:

1. Vercel project → Settings → Deployment Protection → enable.
2. Origin Next.js middleware reject request KHÔNG có header `x-edge-verified=<EDGE_SHARED_SECRET>` (trừ `/__health`).
3. Custom domain trỏ về `cogniva-edge.workers.dev` thay vì Vercel.

## Cost estimate

Workers paid plan ($5/mo bundled):
- 10M requests/month included
- DO: 1M requests + 400K GB-s storage
- KV: 10M reads + 1M writes

Cogniva Stage 2 target (10K MAU):
- ~30M requests/month → $5 base + $0.30/M extra = ~$10/mo
- DO: ~30M rate-limit checks → +$3/mo
- KV: ~3M flag reads → $0 (within 10M)

**Total: ~$15/mo cho 10K MAU.** Khi lên 100K MAU → ~$80/mo.

## Roadmap

- [x] M4 W1: Hono + wrangler setup
- [x] M4 W1: RateLimitDO + token bucket
- [x] M4 W2: JWT verify với jose + JWKS
- [x] M4 W2: Geo header + region routing
- [x] M4 W2: CSRF double-submit
- [x] M4 W2: Feature flag KV eval
- [ ] M4 W3: Wire Better Auth JWT plugin ở origin
- [ ] M4 W3: GitHub Action deploy
- [ ] M4 W4: Static API response cache (60s, stale-while-revalidate)
- [ ] M5 W1: Turnstile anti-bot challenge
- [ ] M5 W2: Cloudflare Argo Smart Routing
- [ ] M5 W3: Anycast routing tests + 6 region p99 < 250ms
