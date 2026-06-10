# 🏗️ NestJS Backend Migration — Kế hoạch chi tiết (REV 2)

> **Quyết định 2026-06-10 (chốt bởi owner):** Viết lại backend thành **NestJS chuẩn**
> theo đúng kiến trúc đích, với 4 chốt:
> 1. **Auth = JWT tự triển khai** (access 15 phút + refresh 30 ngày, payload
>    `sub/email/role`) — thay Better Auth.
> 2. **ORM = Prisma** — bỏ Drizzle. Schema sinh bằng `prisma db pull` từ Neon,
>    Prisma Client trong NestJS; phần Postgres đặc thù (pgvector/tsvector/
>    advisory lock) đi qua `$queryRaw` tập trung ở repository.
> 3. **Làm cả Qdrant + Kafka + microservices** — không hoãn, nhưng đi theo
>    giai đoạn: NestJS modular monolith trước (đúng lời khuyên cuối tài liệu
>    kiến trúc), rồi Qdrant + Kafka, rồi tách services.
> 4. **Mobile = React Native (Expo)** — không Flutter (app RN + packages/shared
>    RN-safe đã có).
>
> Migrate kiểu **strangler fig** qua reverse-proxy cùng origin — hệ thống chạy
> liên tục, không mất chức năng nào (ràng buộc cứng).

Tài liệu nguồn: khảo sát code 2026-06-10 (8-agent workflow, mọi con số verified
từ code) + tài liệu kiến trúc đích + `docs/plans/master.md` + `scale-up.md`.

---

## 📑 Mục lục

1. [Hiện trạng đã verify](#1-hiện-trạng-đã-verify)
2. [Kiến trúc đích & lộ trình 3 giai đoạn](#2-kiến-trúc-đích--lộ-trình-3-giai-đoạn)
3. [Thiết kế Auth JWT](#3-thiết-kế-auth-jwt)
4. [Data layer Prisma (bỏ Drizzle)](#4-data-layer-prisma-bỏ-drizzle)
5. [Chuẩn NestJS "từng tí một"](#5-chuẩn-nestjs-từng-tí-một)
6. [Bảng mapping domain → module → service](#6-bảng-mapping-domain--module--service)
7. [Giai đoạn 1 — NestJS hoá (Wave 0–7)](#7-giai-đoạn-1--nestjs-hoá)
8. [Giai đoạn 2 — Qdrant + Kafka](#8-giai-đoạn-2--qdrant--kafka)
9. [Giai đoạn 3 — Tách microservices](#9-giai-đoạn-3--tách-microservices)
10. [Lưới an toàn: contract test + exit criteria](#10-lưới-an-toàn)
11. [Những gì giữ nguyên / hoãn](#11-giữ-nguyên--hoãn)
12. [Rủi ro xếp hạng + mitigation](#12-rủi-ro-xếp-hạng)
13. [Dọn dẹp docs đi kèm](#13-dọn-dẹp-docs)

---

## 1. Hiện trạng đã verify

Mọi con số dưới đây **đếm từ code 2026-06-10**, KHÔNG lấy từ master.md (master.md
ghi ~30 routes / 21 bảng — stale ~9 lần so với thực tế, đã đính chính ở callout
đầu master.md).

### 1.1. Bề mặt API
- **270 file `route.ts`** trong `apps/web/src/app/api/**`, gom thành **~40 domain**.
  Lớn nhất: admin (40), library (33), tutoring (31), channels (26), groups (26).
- **Validation:** zod inline trong **132 file** (464 `z.object`) — chưa có shared
  schema layer; client đang phụ thuộc error shape `{ error: parsed.error.flatten() }`.
- **Route đặc biệt khó dời:** Better Auth catch-all `/api/auth/[...all]`; streaming
  Vercel AI SDK (`/api/chat`, quick-gen, generate-questions — data stream protocol
  mà `useChat` parse); file proxy `[...key]` (R2); webhook HMAC (VNPay/Momo);
  `/api/realtime/auth` (consumer = apps/realtime, server-to-server).

### 1.2. Data layer
- `packages/db/src/schema.ts` **3.990 dòng, ~95 bảng + 25 enum**, 59 migration SQL.
- Postgres đặc thù đang dùng thật: **pgvector(1024) + HNSW `vector_cosine_ops`**
  (6 cột embedding), **GIN `to_tsvector`** (full-text), **partial unique index**
  (`quiz_response… WHERE attempt_id IS NULL`), **`pg_advisory_xact_lock`**
  (`lib/concepts/dedup.ts` — verified), jsonb, composite PK.
- Query: ~808 chỗ `db.select/insert/update` (Drizzle), **78 `db.transaction`**,
  ~20 raw `` sql`` ``. Driver `postgres.js` `prepare:false` (bắt buộc Neon pooler).
- **DB runtime = Neon** (`apps/web/.env.local`), KHÔNG phải localhost (memory
  `reference_db_neon_vs_local_migrations`).

### 1.3. Auth hiện tại (Better Auth 1.6.10 — sẽ thay bằng JWT, §3)
- Cookie `better-auth.session_token`; session Postgres + **Redis `ba:`** (5 phút,
  fail-open); 30 ngày sliding. Password hash **scrypt** (format Better Auth, lưu
  ở bảng `account` providerId=`credential`).
- JWT plugin + bearer **đang chạy cho mobile**: EdDSA Ed25519, JWKS
  `/api/auth/jwks`, token qua header `set-auth-token`, mobile SecureStore + Bearer.
- Có thật: 2FA TOTP, COPPA parental-consent (<13), Google OAuth (conditional),
  admin roles `SUPER_ADMIN/ADMIN/SUPPORT` + `ADMIN_EMAILS`, impersonation
  (cookie `cogniva-imp` → middleware chặn mutation). **Chưa có reset password.**
- Consumer server-to-server: apps/realtime gọi `POST /api/realtime/auth`;
  apps/hocuspocus verify JWT (`JWT_SECRET`); mobile Bearer.

### 1.4. Hạ tầng nền
- **BullMQ:** 3 queue (`recording` c=2 retry=2, `document` c=2 retry=3, `cron`
  serial attempts=1) + **11 cron**; worker = process 2 của apps/web.
- **Redis:** `cached()` cache-aside, **26 key `ck.*`** + **17+ invalidator
  choke-point**, ZSET `LB_XP`, rate-limit fixed-window, tất cả **fail-open**.
- **apps/realtime:** Socket.IO tự host (redis-adapter), presence ref-count,
  contract 27 events + 6 channel kinds ở `packages/shared/src/realtime/*`,
  Next emit qua `@socket.io/redis-emitter` (60 call-site).
- **apps/hocuspocus** (Yjs), **apps/edge** (CF Workers gateway — độc lập).
- **Storage R2**, **LiveKit** (token 2h, egress → Groq Whisper).

### 1.5. AI pipeline
- `lib/ai/router.ts`: 7+ use case, chain anthropic→groq→gemini→openrouter, nhưng
  **thực tế 100% Groq free** (ANTHROPIC_API_KEY rỗng). Cost guardrail 3 lớp +
  circuit breaker Redis + `ai_usage_log` + semantic cache.
- Ingest: unpdf → chunk 2000/200 → **Voyage-3 1024-dim** batch 128 → concept
  extract → dedup cosine 0.85 + advisory lock → prerequisite mining.
- RAG: basic (pgvector top-5) / advanced (HyDE + BM25 + RRF + rerank).
- **`@mastra/core` = dep ma 0 import** — gỡ ở Wave 0.

### 1.6. Độ dính frontend ↔ backend
- **33 pages/layouts + 33 components + ~60 lib server-only** import thẳng
  `@cogniva/db` (page gọi lib function, không gọi /api). Không dùng Server Actions.
- `packages/shared` (RN-safe): fetch client, types, `qk.*`, zod — tái dùng nguyên.
- Mobile RN: `EXPO_PUBLIC_API_URL` + Bearer — cùng origin thì không phải sửa route.

---

## 2. Kiến trúc đích & lộ trình 3 giai đoạn

### 2.1. Kiến trúc đích (theo tài liệu kiến trúc + chốt của owner)

```
Internet → Cloudflare → API Gateway (NestJS apps/gateway: JWT verify · rate limit
                         · routing · logging)
            │
   ┌────────┴─────────┬───────────────┬──────────────┬─────────────┐
   ▼                  ▼               ▼              ▼             ▼
 Web (Next.js      Mobile (RN      apps/realtime  apps/hocuspocus  apps/edge
 = PURE frontend)   Expo)          (Socket.IO)    (Yjs)            (CF Workers)
            │ JWT Bearer/cookie
            ▼
 ┌──────────────────────────── Services (NestJS) ────────────────────────────┐
 │ auth-service · user-service · learning-service · workspace-service ·      │
 │ knowledge-graph-service · ai-service · search-service · group-service ·   │
 │ notification-service · analytics-service · billing-service               │
 └──────────────┬─────────────────────────────────────────────┬─────────────┘
                ▼                                             ▼
             Kafka (event bus)                        BullMQ (background jobs)
                │                                             │
   ┌────────────┼──────────────┬──────────────┬───────────────┤
   ▼            ▼              ▼              ▼               ▼
 PostgreSQL   Redis         Qdrant       Cloudflare R2     LiveKit
 (Neon)     (cache/queue)  (vectors)     (objects)        (WebRTC)
                                  ▼
                        Groq / Gemini / OpenRouter (LLM)
```

### 2.2. Lộ trình 3 giai đoạn — vì sao không nhảy thẳng microservices

Chính tài liệu kiến trúc đích kết luận: *"đừng bắt đầu bằng microservices. Hãy làm
NestJS Monolith (Auth/User/Learning/AI/Search/Notification Module) rồi mới tách
dần"* — và ràng buộc cứng của pivot là **không mất chức năng, hệ chạy liên tục**.
Tách service khi code còn nằm trong Next route handlers là bất khả thi; phải
NestJS-hoá + module-hoá trước thì ranh giới service mới tồn tại để cắt.

| Giai đoạn | Nội dung | Kết quả bàn giao |
|---|---|---|
| **GĐ1 — NestJS hoá** (Wave 0–7, §7) | `apps/api` modular monolith: toàn bộ 270 route thành controllers/services/**repositories raw SQL**; **AuthModule JWT mới** thay Better Auth; worker BullMQ sang Nest; Swagger phủ 100% | Next = pure frontend; backend NestJS chuẩn chạy prod |
| **GĐ2 — Qdrant + Kafka** (§8) | Vector store → Qdrant (6 collection); Kafka event bus thay fire-and-forget fanout (vẫn trong monolith — topics chuẩn bị sẵn ranh giới service) | Search chạy Qdrant; event-driven backbone hoạt động |
| **GĐ3 — Tách microservices** (§9) | `apps/gateway` + tách dần service theo module boundary; database-per-service từng bước | Kiến trúc đích §2.1 |

**Topology trong suốt GĐ1–2: reverse-proxy CÙNG ORIGIN** (strangler fig):
- Dev: `next.config.mjs` `rewrites().beforeFiles` per-prefix → `http://localhost:4000`.
  `beforeFiles` thắng route file đang tồn tại → cutover an toàn, rollback = xoá 1 dòng.
- Prod VPS: rule prefix ở Caddy/Nginx → `:4000`.
- KHÔNG đổi origin trước GĐ3 (SameSite/CORS/R2/preflight — vỡ đăng nhập diện rộng).
  Sang GĐ3, `apps/gateway` tiếp quản vai trò proxy này.

---

## 3. Thiết kế Auth JWT

Thay Better Auth bằng **AuthModule NestJS tự triển khai** (`@nestjs/jwt` +
`@nestjs/passport`), đúng spec tài liệu đích, **không mất feature đang có**.

### 3.1. Token model

| Token | TTL | Dạng | Lưu ở đâu |
|---|---|---|---|
| **Access token** | 15 phút | JWT ký **ES256 (asymmetric)** — payload `{ sub, email, role, plan, iss: 'cogniva', aud: 'cogniva-app' }` | Web: httpOnly cookie `cg_at` (SameSite=Lax). Mobile: SecureStore, gửi `Authorization: Bearer` |
| **Refresh token** | 30 ngày, **rotation mỗi lần dùng** | Opaque random 256-bit; DB lưu **hash** (bảng `refresh_token`: id, user_id, token_hash, family_id, expires_at, revoked_at, ip, user_agent) | Web: httpOnly cookie `cg_rt` (path=/api/auth). Mobile: SecureStore |

- **Vì sao asymmetric (không HS256):** GĐ3 các service + gateway + apps/realtime +
  hocuspocus verify access token **cục bộ bằng public key** (JWKS endpoint
  `/api/auth/jwks` — tái dùng bảng `jwks` sẵn có) — không round-trip, đúng
  microservices. Bonus: apps/realtime bỏ được HTTP call verify mỗi CONNECT.
- **Rotation + reuse-detection:** refresh dùng lại token đã rotate (cùng
  `family_id`) → revoke cả family (chống token bị trộm). Logout = revoke family.
- **Revocation access token:** TTL 15 phút là cửa sổ chấp nhận được; thêm Redis
  denylist `jwt:deny:<jti>` cho force-signout/admin-suspend (check trong guard,
  fail-open như chuẩn hệ).

### 3.2. Endpoints (AuthController — `@Public()` trừ khi ghi chú)

```
POST /api/auth/sign-up           # email+password (✅ Wave 1 — COPPA đã CẮT khỏi
                                 # scope 2026-06-10 theo quyết định owner: không
                                 # DOB/parental consent nữa)
POST /api/auth/sign-in           # trả access+refresh (✅; user 2FA tạm 403 → dùng
                                 # flow cũ tới khi port 2FA)
POST /api/auth/sign-in/2fa       # verify TOTP sau bước 1 (còn lại Wave 1)
POST /api/auth/refresh           # rotation; reuse-detection (✅)
POST /api/auth/sign-out          # revoke refresh family (✅)
GET  /api/auth/jwks              # public keys ES256, kid RFC7638 (✅ — key từ env,
                                 # rotation qua bảng để sau)
GET  /api/auth/me                # session info (✅)
POST /api/auth/forgot-password   # MỚI — token 1h one-time (✅; email Resend chưa
                                 # wire — dev log console)
POST /api/auth/reset-password    # MỚI (✅ — one-time + revoke mọi refresh)
GET  /api/auth/google            # OAuth redirect (còn lại Wave 1)
GET  /api/auth/google/callback   # upsert account → phát token (còn lại Wave 1)
POST /api/auth/2fa/enable|verify|disable   # otplib TOTP (còn lại Wave 1)
POST /api/auth/verify-email      # port logic hiện có (còn lại Wave 1)
```

### 3.3. Tương thích dữ liệu & migration không mất user

1. **Password:** giữ nguyên bảng `account` — verify **tương thích format scrypt
   của Better Auth**; đăng nhập thành công → **rehash sang argon2id** (progressive,
   không ai phải đổi mật khẩu).
2. **Bảng:** `user` giữ nguyên (cột COPPA cũ để nguyên trong DB, không dùng); thêm
   `refresh_token` (migration mới); `session` cũ giữ đọc trong cửa sổ chuyển tiếp
   rồi drop; `jwks`, `two_factor`, `verification` tái dùng.
3. **Cửa sổ chuyển tiếp (dual-accept, 1–2 wave):** `JwtAuthGuard` chấp nhận
   **(a)** access token mới, **(b)** Bearer JWT Better Auth cũ (mobile đã phát —
   verify cùng JWKS), **(c)** cookie session Better Auth cũ (verify qua Redis
   `ba:` + bảng session) — user đang đăng nhập KHÔNG bị đá ra. Sau cửa sổ:
   chỉ còn (a).
4. **Client:** web sign-in/up form đổi sang endpoint mới + interceptor auto-refresh
   (React Query); mobile đổi `set-auth-token` → body token + refresh flow ở
   `packages/shared/api`. Realtime gateway: verify JWT cục bộ (public key) cho
   CONNECT; membership authorize vẫn gọi endpoint (data lookup).
5. **Impersonation:** port thành claim `imp: <adminId>` trong access token đặc
   biệt TTL ngắn + `ImpersonationGuard` chặn mutation (thay cookie `cogniva-imp`).
6. **Better Auth gỡ hẳn** (dep + `/api/auth/[...all]` + plugins) khi: 100% client
   dùng flow mới + OAuth/2FA parity test pass. (COPPA đã cắt khỏi scope —
   parental-consent routes của Next sẽ xoá luôn khi gỡ Better Auth.)

### 3.4. Guards chuẩn

`JwtAuthGuard` (APP_GUARD mặc định + `@Public()`), `RolesGuard`
(`@Roles('ADMIN','SUPER_ADMIN')` — port ma trận `requireAdminRole` + `ADMIN_EMAILS`),
`RateLimitGuard`
(`@RateLimit('aiGenerate')` — wrap checkLimit Redis), `ImpersonationGuard`.

---

## 4. Data layer Prisma (bỏ Drizzle)

**Chốt:** bỏ Drizzle, chuyển **Prisma** (đúng yêu cầu gốc "chuẩn NestJS + Prisma
+ Swagger" và tài liệu kiến trúc đích). NestJS + Prisma là cặp ecosystem chuẩn:
`PrismaService` injectable, type-safe client sinh từ schema.

### 4.1. Khởi tạo schema từ DB thật (không viết tay 95 bảng)

- `prisma db pull` **introspect Neon** → sinh `schema.prisma` (~95 model + 25
  enum) — DB đang chạy là source of truth, không chép tay từ `schema.ts` Drizzle.
- Sau introspect phải **rà tay**: đặt lại tên model/field camelCase (`@map`/
  `@@map`), khai `@relation` cho FK, đánh dấu 6 cột embedding
  `Unsupported("vector(1024)")`.
- **Connection Neon:** datasource `url` = pooled string + `?pgbouncer=true`
  (tương đương `prepare:false` hiện tại), `directUrl` = unpooled cho migrate.
  Replica đọc: `@prisma/extension-read-replicas` (map `dbReplica` hiện có).
- Vị trí: `apps/api/prisma/` (schema + migrations) — API sở hữu DB từ giờ.

### 4.2. Migrations

- **Baseline:** `prisma migrate diff --from-empty --to-schema-datamodel` →
  `0_init/migration.sql`, rồi `prisma migrate resolve --applied 0_init` đánh dấu
  đã áp (DB Neon giữ nguyên, không chạy lại gì).
- Schema change từ giờ: `prisma migrate dev` — **được phép sửa tay file SQL sinh
  ra** trước khi apply, và BẮT BUỘC sửa tay cho các thứ Prisma không biểu diễn
  được trong schema: index HNSW (`USING hnsw (… vector_cosine_ops)`), GIN
  `to_tsvector`, partial unique index (`WHERE attempt_id IS NULL`). Các index này
  tồn tại trong migration SQL, không tồn tại trong schema.prisma → ghi chú rõ
  từng cái trong file `apps/api/prisma/NOTES.md` để không bị `migrate dev` đời
  sau drop nhầm (kiểm diff trước khi apply).
- Migration apply vào **Neon** (nhớ bài học `reference_db_neon_vs_local_migrations`)
  + local docker để dev.
- Dòng migration Drizzle cũ (`packages/db/migrations/0000–0057`) đóng băng làm
  lịch sử; `packages/db` bị gỡ dần và xoá khi web không còn import (cuối GĐ1).

### 4.3. Query convention

```
modules/<domain>/
├─ <domain>.service.ts      # business logic — dùng PrismaService (typed) trực tiếp
├─ <domain>.repository.ts   # CHỈ chứa $queryRaw/$executeRaw (vector, tsvector,
│                           # advisory lock, aggregation phức) — raw SQL không
│                           # được rải trong service
└─ <domain>.controller.ts
```

- 808 query sites Drizzle → Prisma Client typed API (`findMany/create/update` +
  `include/select`); **78 transaction** → `prisma.$transaction(async (tx) => …)`
  (interactive); advisory lock giữ nguyên:
  `await tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtext(${key}))\``.
- Vector search/hybrid (`embedding <=> $1::vector`, `to_tsvector`) → `$queryRaw`
  trong repository. **GĐ2 chuyển Qdrant sẽ XOÁ luôn điểm đau lớn nhất của Prisma**
  (cột `Unsupported` + raw vector SQL biến mất khỏi Postgres) — 2 quyết định
  này cộng hưởng.
- JSONB: Prisma update là full-replace per field → các chỗ patch jsonb lớn
  (metadata, reactions) giữ `$executeRaw` `jsonb_set` trong repository.
- Effort: **+~30–40% mỗi wave** so với giữ Drizzle (viết lại query khi port
  domain) — đã tính vào estimate §7. Trang SSR của web trong transition vẫn đọc
  qua Drizzle cũ (đóng băng) cho tới wave của domain đó — 2 client cùng đọc 1 DB,
  vô hại.

---

## 5. Chuẩn NestJS "từng tí một"

### 5.1. Cấu trúc `apps/api`

```
apps/api/
├─ src/
│  ├─ main.ts                  # bootstrap HTTP :4000 — prefix /api, filters, swagger, pino
│  ├─ worker.ts                # bootstrap worker — ApplicationContext + BullMQ processors
│  ├─ app.module.ts
│  ├─ common/
│  │  ├─ guards/               # jwt-auth · roles · rate-limit · impersonation
│  │  ├─ decorators/           # @Public() · @CurrentUser() · @Roles() · @RateLimit()
│  │  ├─ filters/              # app-exception.filter.ts — GIỮ shape {error: flatten()}
│  │  ├─ interceptors/         # audit-log · request-logging (traceId)
│  │  └─ pipes/                # zod-validation.pipe.ts (nestjs-zod)
│  ├─ infra/
│  │  ├─ config/               # ConfigModule + env.schema.ts (zod — kiểm GIÁ TRỊ env)
│  │  ├─ database/             # prisma.module.ts → PrismaService (+ read-replicas ext)
│  │  ├─ redis/                # cache.service (cached/ck) · invalidation.service (17 hàm)
│  │  ├─ queue/                # @nestjs/bullmq — 3 queue + cron specs (giữ nguyên văn)
│  │  ├─ events/               # GĐ1: EventBusService interface (impl: redis-emitter)
│  │  │                        # GĐ2: impl Kafka (kafkajs) — cùng interface (§8)
│  │  ├─ vector/               # GĐ1: pgvector impl · GĐ2: Qdrant impl (§8)
│  │  ├─ storage/  realtime/  livekit/
│  │  └─ ai/                   # router multi-provider · guardrail · circuit · semantic-cache
│  └─ modules/                 # 1 thư mục = 1 bounded context = ranh giới service GĐ3
│     └─ <domain>/ (module · controller · service · repository · dto/ · processor?)
├─ test/  (e2e + golden/<domain>/*.json)
└─ nest-cli.json · tsconfig (extend tooling/tsconfig) · package.json
```

### 5.2. Convention bắt buộc

| Hạng mục | Chuẩn |
|---|---|
| HTTP adapter | **Express** — AI SDK `pipeDataStreamToResponse(res)`, Multer, passport strategies |
| Prefix/path | `setGlobalPrefix('api')`, **giữ NGUYÊN path hiện tại** — KHÔNG /v1 trong migration (đổi path = vỡ client; versioning để GĐ3 gateway) |
| DTO/validation | **zod + `nestjs-zod`** (`createZodDto`) — tái dùng 132 file zod, tự sinh OpenAPI (`patchNestjsSwagger`). Cấm validate tay trong controller |
| Error shape | Mọi lỗi qua `AppExceptionFilter`: `{ error: string \| FlattenedZodError }` + status hiện hành (400/401/403/404/409/423/429/503) — client không sửa 1 dòng |
| Swagger | `@nestjs/swagger`: `addBearerAuth()` + `addCookieAuth('cg_at')`, `@ApiTags` theo module, UI `/api/docs` (non-prod hoặc sau RolesGuard) |
| Config | `ConfigModule.forRoot({ validate })` — zod validate env lúc boot, kiểm **giá trị** không chỉ "có set" (bài học ANTHROPIC_API_KEY rỗng) |
| Logging | `nestjs-pino` + traceId |
| Health | `@nestjs/terminus` `/api/healthz` (DB + Redis + Qdrant/Kafka ở GĐ2) |
| Lifecycle | `enableShutdownHooks()`; đóng BullMQ/Redis/postgres/Kafka producers khi SIGTERM |
| Testing | unit (service) + integration (repository vào Postgres docker) + e2e supertest + golden snapshot (§10) |
| Comments | **Tiếng Việt đầy đủ** — header + JSDoc + inline (chuẩn repo) |
| Cache | Mọi write qua service PHẢI gọi đúng invalidator choke-point (chuẩn `feedback_conform_arch_standards`) |

### 5.3. Hạ tầng dùng CHUNG Next ↔ Nest trong transition

33 trang SSR còn đọc DB trực tiếp + Nest cũng đọc/ghi → 2 process **phải dùng
chung 1 bộ key cache + invalidator**, fork format = stale-data "lúc đúng lúc sai".

**Giải pháp — `packages/server-core` (Node-only):** move từ `apps/web/src/lib`:
`redis.ts`, `cache/keys.ts`, `cache/invalidate.ts`, `cache/leaderboard.ts`,
`rate-limit/`, `realtime-server.ts`, `r2-client.ts`, `livekit.ts`. Web + Nest cùng
import → 1 nguồn format duy nhất. (Wave 1; web chỉ đổi import.)

---

## 6. Bảng mapping domain → module → service

Cột cuối = service đích GĐ3 (theo diagram kiến trúc): module boundary GĐ1 chính
là đường cắt GĐ3.

| Nest module (GĐ1) | Routes (số lượng) | Jobs kèm | Wave | Service GĐ3 |
|---|---|---|---|---|
| `AuthModule` | auth JWT mới (§3.2) — COPPA/parental-consent đã cắt | — | 1 ✅ core | **auth-service** |
| `UsersModule` | profile (2), user/status (1), account (5) | process-gdpr-deletion | 2 | **user-service** |
| `LearningModule` | atoms (2), mastery (4), notes (3), study-plan (4) | — | 2 | **learning-service** |
| `GraphModule` | graph (3) | — | 2 | **knowledge-graph-service** |
| `GamificationModule` | leaderboard (1), analytics (1) | reconcile-leaderboard | 2 | **analytics-service** |
| `SearchModule` | search (1), chunks (1) | — | 2 | **search-service** |
| `WorkspacesModule` | workspaces (10) | — | 3 | **workspace-service** |
| `DocumentsModule` | documents (6: upload + file proxy) | document queue (extract-concepts) | 3 | **workspace-service** |
| `FlashcardsModule` | flashcards (8) | flashcard-due-reminder | 3 | **learning-service** |
| `QuizModule` | quiz (4), questions (1) | — | 3 | **learning-service** |
| `ExamsModule` | exams (10), attempts (5) | — | 3 | **learning-service** |
| `ConversationsModule` | conversations GET (3) | — | 3 | **ai-service** |
| `GroupsModule` | groups (26), dm (2) | thread-archive-stale | 4 | **group-service** |
| `ChannelsModule` | channels (26) | — | 4 | **group-service** |
| `RoomsModule` | rooms (10) | recording queue | 4 | **group-service** |
| `RealtimeAuthModule` | realtime/auth (1) | — | 4 | gateway/auth |
| `NotificationsModule` | notifications (2), reports (1) | push Expo | 4 | **notification-service** |
| `LibraryModule` | library (33) | 3 cron library | 5 | **workspace-service** (hoặc tách library-service) |
| `TutoringModule` | tutoring (31) + tutors | 3 cron tutoring | 6 | **billing-service** + user-service |
| `WalletModule` | wallet (2) | — | 6 | **billing-service** |
| `WebhooksModule` | vnpay/momo/livekit (3) — `@Public()` + HMAC guard | — | 6 | **billing-service** |
| `ChatModule` | chat streaming (3), ai/quick-gen (1), generate (3) | — | 7 | **ai-service** |
| `AdminModule` | admin (40), debug (1) | — | 7 | gateway + per-service admin |

> Tổng ≈ 270 route + ~14 endpoint auth mới. Controller giữ path y hệt route cũ.
> Service nhận logic move từ `apps/web/src/lib/<domain>` (**move-once**).

---

## 7. Giai đoạn 1 — NestJS hoá

Ước lượng 1 dev + AI. Hệ chạy được ở MỌI thời điểm giữa 2 wave. Mỗi wave kết
thúc bằng exit criteria §10.2. (Đổi ORM sang Prisma làm wave dài hơn ~30–40%
so với phương án giữ Drizzle — đã tính vào estimate.)

### Wave 0 — Skeleton + spikes (4–6 ngày)
1. Scaffold `apps/api` (§5.1) + turbo/pnpm wiring (`pnpm dev` thêm api:4000).
2. `ConfigModule` env zod (CÙNG `DATABASE_URL` Neon + `REDIS_URL` như web —
   ghi rõ `.env.example`, đừng lặp lỗi localhost/Neon).
3. **Prisma setup:** `prisma db pull` từ Neon → rà schema (map/relation/
   Unsupported vector) → baseline `migrate diff` + `migrate resolve` (§4.2);
   `PrismaModule` + read-replicas ext; `RedisModule`, `AppExceptionFilter`,
   pino, terminus, Swagger chạy được.
4. **Spike A — JWT keys & dual-accept:** sinh keypair ES256/EdDSA vào bảng `jwks`;
   guard verify (a) token mới, (b) JWT Better Auth cũ, (c) cookie session cũ qua
   Redis `ba:`. Proof e2e bằng session/token thật.
5. **Spike B — Streaming:** Nest + AI SDK `pipeDataStreamToResponse`, so byte-level
   với `/api/chat` (data stream protocol của `useChat`). Chưa chắc ăn → /api/chat
   ở lại Next tới Wave 7 (đã dự phòng).
6. **Spike C — Proxy:** rewrite `beforeFiles` `/api/healthz` → :4000, cookie/header
   xuyên suốt.
7. Migration Prisma đầu tiên: bảng `refresh_token` (`prisma migrate dev`,
   apply cả Neon lẫn local docker).
8. Golden-snapshot harness (§10.1). Gỡ dep `@mastra/core`.

### Wave 1 — AuthModule JWT (1.5–2 tuần — wave hệ trọng nhất)
- Toàn bộ §3: sign-up/in/refresh/out, scrypt-compat + argon2id rehash, rotation +
  reuse-detection, Google OAuth, 2FA TOTP, **forgot/reset password
  (feature mới)**, email verify, JWKS, guards đầy đủ, denylist Redis.
  (COPPA cắt khỏi scope theo quyết định owner 2026-06-10.)
  **Tiến độ 2026-06-10 ✅ server-side XONG + proof 22 checks:** sign-up/in/out,
  refresh rotation + reuse-detection, forgot/reset, /me, JWKS, hash scrypt 2
  chiều tương thích BA, **2FA TOTP sign-in 2 bước** (decrypt XChaCha20-Poly1305
  đúng format BA), **Google OAuth** (authorization-code + state cookie; 503 khi
  thiếu env — cần đăng ký redirect URI `${APP_URL}/api/auth/google/callback`),
  **DUAL-ISSUE**: sign-in/up flow mới phát kèm session Better Auth (cookie +
  row DB) → SSR/API cũ của Next nhận user ngay, web switch không phải sửa
  hàng trăm điểm getSession (gỡ cùng Better Auth cuối GĐ1); sign-out revoke cả
  2 hệ. Bảng mới apply cả Neon + docker. **Còn lại Wave 1:** email Resend,
  client web/mobile switch sang endpoint mới, 2FA enable/disable (tạm ở legacy),
  denylist force-signout.
- Client: web form + interceptor auto-refresh; mobile token flow ở
  `packages/shared/api`; dual-accept BẬT (user hiện tại không bị đá).
- Tách `packages/server-core` (§5.3).
- Test nặng: unit token rotation/reuse, e2e 3 nhánh dual-accept, smoke mobile.

### Wave 2 — Pilot domain nhỏ (≈22 routes, 1–1.5 tuần)
- `UsersModule`, `LearningModule`, `GraphModule`, `GamificationModule`,
  `SearchModule`, `HealthModule` — chứng minh chuỗi đầy đủ: controller → service
  → **Prisma (+ $queryRaw repository khi cần)** → cache/invalidate → snapshot →
  cutover → xoá route cũ.
- Port cron: health-monitor, reconcile-leaderboard (tắt job tương ứng ở worker cũ
  — không double-run).

### Wave 3 — Core học tập (≈51 routes, 2–2.5 tuần)
- `WorkspacesModule`, `DocumentsModule` (Multer 50MB + ingest pipeline service +
  document processor), `FlashcardsModule` (ts-fsrs service), `QuizModule`
  (advisory lock + BKT giữ nguyên), `ExamsModule` + attempts, `ConversationsModule`
  GET. File proxy → `StreamableFile` (Content-Type/Cache-Control y hệt).
- SSR pages: **write-path-first** — trang read SSR tạm giữ đọc DB cũ (xem nguyên
  tắc cuối §7).

### Wave 4 — Social/realtime (≈68 routes, 1.5–2 tuần)
- `GroupsModule`, `ChannelsModule`, `RoomsModule` (+ recording processor +
  Whisper/ffmpeg service), `RealtimeAuthModule`, `NotificationsModule`.
- apps/realtime: chuyển CONNECT sang **verify JWT cục bộ** (public key — bỏ
  HTTP round-trip), membership authorize → endpoint Nest; dual-accept 1 wave +
  socket/presence/voice smoke trước khi xoá route cũ. Hocuspocus: align verify
  sang JWKS (thay JWT_SECRET đối xứng).

### Wave 5 — Library (33 routes, 1–1.5 tuần)
- `LibraryModule`: hybrid search (SQL pgvector + tsvector — sang GĐ2 đổi adapter
  Qdrant), R2 proxy, purchase/PRO gate (402), karma, annotation + 3 cron.

### Wave 6 — Tiền (≈37 routes, ~1.5 tuần — cẩn trọng nhất)
- `TutoringModule`, `WalletModule`, `WebhooksModule`.
- Trước cutover: **replay-test webhook bằng signed fixtures** (VNPay + Momo, GET
  lẫn POST), idempotency (double-delivery không double-credit). Escrow/payout
  cron giữ nguyên văn.

### Wave 7 — AI/streaming + Admin + chốt hạ (≈56 routes, 2 tuần)
- `infra/ai` hoàn thiện (router DI, guardrail, circuit, semantic cache);
  `ChatModule` streaming (Spike B); migrate nốt `getChatModel()` legacy; giữ
  behavior **conversation auto-create trong POST /api/chat**.
- `AdminModule` (40 routes — read-heavy, để cuối an toàn).
- **Tắt hẳn worker cũ**; **gỡ Better Auth** (hết dual-accept); **gỡ Drizzle**
  khỏi web (trang SSR còn lại chuyển gọi Nest server-to-server forward
  cookie/Bearer, hoặc client-fetch qua React Query có sẵn).

**Nguyên tắc xuyên suốt GĐ1:**
- **Move-once:** port domain = move lib server-only thành service+repository;
  route Next cũ **xoá sau 48h cutover xanh**. Cấm logic sống 2 nơi quá 1 wave.
- **Write-path-first cho SSR:** trang read-only giữ direct-DB (Drizzle cũ) tới
  wave domain của nó — write + invalidation đã tập trung ở Nest nên không lệch.
- **`packages/shared` là contract** web+mobile — types/zod/query-keys mới đặt ở đó.

---

## 8. Giai đoạn 2 — Qdrant + Kafka (sau GĐ1, ~2–3 tuần)

### 8.1. Qdrant (vector store) — ~1–1.5 tuần

- **Docker compose** thêm service `qdrant` (single node, volume).
- `infra/vector`: interface `VectorStore` (`upsert/search/delete`, filter theo
  payload) — 2 impl: `PgVectorStore` (hiện tại) và `QdrantStore`
  (`@qdrant/js-client-rest`). Cấu hình chọn impl qua env → **cutover per
  collection, rollback = đổi env**.
- **6 collection** (map từ 6 cột embedding): `chunks`, `concepts`,
  `library_chunks`, `library_atoms`, `tutor_bios`, `tutor_requests` — vector
  1024 cosine; payload: `userId`, `documentId`, `workspaceId`, `domain`… (đủ cho
  filter user-scope như WHERE hiện tại).
- **Backfill script:** đọc pgvector theo batch → upsert Qdrant (idempotent theo
  id) → so sánh top-K recall trên bộ query mẫu trước khi bật.
- **Hybrid search:** Qdrant (vector) + Postgres tsvector (BM25) → RRF trong app
  (logic RRF đã có ở advanced retrieval — chỉ đổi nguồn vector).
- Sau khi 6 collection xanh: drop HNSW index + cột embedding (migration riêng,
  giữ 2 tuần dual-write trước khi drop).

### 8.2. Kafka (event bus) — ~1–1.5 tuần

- **Redpanda single-node** trong docker-compose (Kafka-compatible, nhẹ RAM cho
  VPS — đúng gợi ý scale-up.md; bus là Kafka API nên gọi "Kafka" trong báo cáo
  là chuẩn).
- `infra/events`: `EventBusService` (interface có sẵn từ GĐ1, impl redis-emitter)
  thêm impl **kafkajs**: producer (acks=all, idempotent) + consumer groups.
- **Topics khởi điểm** (đặt theo ranh giới service GĐ3):

| Topic | Producer | Consumers (GĐ2 = consumer trong cùng monolith) |
|---|---|---|
| `user.registered` | AuthModule | Notification (welcome/consent email), Analytics |
| `document.uploaded` | DocumentsModule | Ingest (thay enqueue trực tiếp), Analytics |
| `document.processed` | IngestModule | Notification, Search (index), KG (concepts) |
| `quiz.attempted` / `flashcard.reviewed` | Learning | Analytics, Gamification (XP), KG (mastery/BKT) |
| `booking.created` / `payment.captured` | Tutoring/Webhooks | Notification, Billing ledger, Analytics |
| `group.message.created` | Channels | Notification (mention), Moderation |
| `notification.send` | mọi module | NotificationsModule (Expo push/email) |

- **Ranh giới Kafka vs BullMQ (cùng tồn tại — đúng tài liệu đích):** Kafka =
  **sự kiện** fan-out cho consumer khác domain (pub/sub, nhiều consumer);
  BullMQ = **job** nặng có retry/checkpoint (ffmpeg, Whisper, embed, cron).
  Pattern chuẩn: event Kafka → consumer enqueue BullMQ job.
- Consumer **idempotent** (key theo event id + bảng/redis dedup), outbox đơn giản:
  ghi event sau commit DB; chấp nhận at-least-once.
- Realtime emitter (Socket.IO redis-emitter) **giữ nguyên** — đó là đường
  client-push, không phải event bus backend.

---

## 9. Giai đoạn 3 — Tách microservices (~3–4 tuần khởi điểm)

Chỉ bắt đầu khi GĐ1+2 xanh. Module boundary GĐ1 = đường cắt; Kafka GĐ2 = dây
liên lạc — việc tách trở thành "move thư mục module sang app mới".

### 9.1. Thứ tự tách (mỗi bước hệ vẫn chạy)

1. **`apps/gateway`** (NestJS): tiếp quản reverse-proxy — JWT verify (public key),
   rate-limit (Redis), routing table prefix→service, request logging/trace,
   CORS cho mobile. Web/mobile từ giờ chỉ biết gateway.
2. **auth-service** tách đầu tiên (ít phụ thuộc, mọi service khác chỉ cần public
   key — không gọi auth lúc runtime).
3. **notification-service** (consumer thuần Kafka — tách dễ nhất, rủi ro thấp).
4. **ai-service** (chat/generation/router — tải nặng nhất, lợi scale rõ nhất)
   + **search-service** (Qdrant + BM25).
5. **learning / workspace / group / billing / user / analytics / knowledge-graph**
   — tách dần theo nhu cầu (deploy block? scale bottleneck?), không tách lấy được.

### 9.2. Database-per-service — từng bước, không big-bang

- Bước 1 (logical): mỗi service own **schema riêng trong cùng Postgres**
  (`auth.*`, `learning.*`…) + cấm cross-schema JOIN (enforce bằng review +
  search_path per service user). Dữ liệu cần của nhau → qua API/Kafka.
- Bước 2 (physical): service nào cần thì chuyển sang database/Neon project riêng
  (ưu tiên `auth_db`, `billing_db` — ranh giới bảo mật/tiền). Các service còn
  lại share DB là chấp nhận được ở quy mô hiện tại (distributed monolith —
  đúng Stage 2 scale-up.md).
- FK xuyên ranh giới service → bỏ FK, thay bằng eventual consistency qua Kafka +
  reconcile job (đánh dấu rõ trong migration).

### 9.3. Deploy

- **Docker Compose trên VPS** cho toàn bộ GĐ1–3 khởi điểm (gateway + services +
  redpanda + qdrant + redis + caddy). **K8s chỉ khi** số service × replica vượt
  1 VPS quản nổi — đúng "Giai đoạn đầu: 1 VPS Docker Compose, khi lớn: K8s" của
  tài liệu đích.
- Mỗi service: Dockerfile riêng (template chung), healthcheck, restart policy;
  CI build theo turbo filter.

---

## 10. Lưới an toàn

### 10.1. Golden contract snapshot (dựng ở Wave 0)
- `apps/api/test/contract/capture.ts`: per domain, gọi danh sách route (session
  seed + fixtures) vào **backend hiện tại**, lưu `test/golden/<domain>/*.json`
  (body + status + headers chọn lọc, normalize timestamp/id).
- Port xong domain → chạy CÙNG bộ gọi vào Nest, diff. Pass = shape y hệt. Đây là
  lưới chính chống silent-breakage cho web/mobile (exact JSON: `{error: flatten()}`,
  citations, cursor…). GĐ2 (Qdrant): thêm recall-compare top-K. GĐ3: snapshot
  chạy xuyên gateway.

### 10.2. Exit criteria MỖI wave
1. ✅ Golden snapshot pass toàn bộ route của domain.
2. ✅ typecheck + lint + unit/integration/e2e xanh.
3. ✅ Mobile smoke (Bearer flow) ≥1 endpoint của domain.
4. ✅ E2e happy-path nghiệp vụ chính của domain.
5. ✅ Route Next cũ **xoá** (sau 48h xanh), proxy rule chuyển.
6. ✅ Swagger phủ domain (tags + DTO + auth scheme).
7. ✅ `docs/plans/master.md` cập nhật cùng commit (plan-in-sync).
8. ✅ Chú thích tiếng Việt đầy đủ.

### 10.3. Rollback
- GĐ1: revert 1 proxy rule → traffic về Next (route cũ chỉ xoá sau 48h xanh).
- Auth: dual-accept nghĩa là rollback = client quay lại endpoint cũ; Better Auth
  chỉ gỡ ở cuối GĐ1.
- GĐ2: Qdrant rollback = đổi env impl về pgvector (cột chưa drop); Kafka rollback
  = EventBus impl về redis.
- GĐ3: service mới lỗi → gateway trỏ prefix về monolith (giữ monolith image chạy
  được tới khi service ổn định).

---

## 11. Giữ nguyên / hoãn

**Giữ nguyên:** Neon Postgres (data chính) · Redis · R2 · LiveKit · BullMQ (job
queue — song song Kafka, đúng tài liệu đích) · apps/realtime (Socket.IO — chỉ đổi
cách verify JWT) · apps/hocuspocus · apps/edge · `packages/shared` contract ·
Redis key format + invalidator choke-point + fail-open · AI provider Groq free +
Voyage free · mobile **Expo React Native**.

**Hoãn (ngoài scope 3 giai đoạn này — lý do: thuộc 100K–1M MAU theo scale-up.md):**
K8s/Linkerd (Compose đủ tới khi >1 VPS) · ClickHouse · Neo4j · CockroachDB/multi-region ·
self-host vLLM · Centrifugo · SOC2 · Flutter (chốt RN) · "nhân tiện" refactor
(pagination/error-shape/embedding-dim toàn cục — phá contract client, làm sau khi
có gateway versioning).

## 12. Rủi ro xếp hạng

| # | Rủi ro | Mitigation (đã nhúng vào plan) |
|---|---|---|
| 1 | **Auth JWT mới vỡ đăng nhập diện rộng** (scrypt-compat sai, OAuth/2FA/COPPA thiếu parity, mobile kẹt token cũ) | Wave 1 riêng + dual-accept 3 nhánh (token mới/JWT cũ/cookie session cũ), rehash progressive, parity checklist, Better Auth chỉ gỡ cuối GĐ1 |
| 2 | **Prisma migration drift**: index đặc thù (HNSW/GIN/partial unique) chỉ sống trong SQL migration, `migrate dev` đời sau có thể drop nhầm; jsonb full-replace; advisory lock phải $queryRaw; introspect miss operator class | NOTES.md liệt kê index ngoài-schema + kiểm diff trước apply; $queryRaw tập trung repository; integration test vào Postgres docker; GĐ2 Qdrant gỡ hẳn cột vector |
| 3 | Refresh rotation lỗi (race đa tab/thiết bị) → user bị logout vòng lặp | family_id + grace 30s cho token vừa rotate; e2e đa client |
| 4 | 270 route không lưới test → silent breakage | Golden snapshot TRƯỚC khi port (§10.1) |
| 5 | Logic sống 2 nơi diverge (FSRS/BKT) trong transition | Move-once + write-path-first + xoá route cũ 48h |
| 6 | Streaming lệch byte AI SDK protocol → chat chết web+mobile | Spike B Wave 0; /api/chat ở lại Next tới Wave 7 nếu chưa chắc |
| 7 | Webhook payment sai HMAC/idempotency = mất tiền thật | Wave riêng + replay signed fixtures |
| 8 | Worker port vỡ idempotency (double push/mất transcript) | Giữ nguyên văn jobId/dedupe; port cùng wave domain; không double-run cron |
| 9 | Cache drift Next↔Nest sống chung | `packages/server-core` dùng chung key+invalidator |
| 10 | Qdrant recall lệch pgvector → RAG/search tệ đi âm thầm | Dual-write + recall-compare top-K trước cutover; rollback env |
| 11 | Kafka vận hành trên VPS (RAM, disk, partition) quá sức 1 dev | Redpanda single-node + topics ít partition; Kafka chỉ nhận vai trò fan-out, job nặng vẫn BullMQ |
| 12 | Đứt realtime/collab khi đổi cơ chế verify | JWT verify cục bộ bằng public key + dual-accept 1 wave + socket smoke |
| 13 | Scope tổng (GĐ1≈9–11 tuần, GĐ2≈2–3, GĐ3≈3–4+) vượt thời gian đồ án | Mốc bàn giao hợp lệ ở CUỐI MỖI GIAI ĐOẠN; GĐ3 tách được từng service một, dừng ở đâu hệ vẫn chạy ở đó |

## 13. Dọn dẹp docs

Cùng tiến trình (plan-in-sync — mỗi wave commit kèm):
- `master.md`: §3.2 ORM → "Prisma (pivot từ Drizzle 2026-06-10)"; §3.6 → "JWT
  tự triển khai (access 15'/refresh 30d, JWKS)"; §4 → kiến trúc 3 giai đoạn; bỏ tRPC
  "planned"; Mastra → đã gỡ; Soketi → Socket.IO; số liệu API/bảng theo thực tế.
- `scale-up.md`: chú thích GĐ1–3 của file này map vào Stage 1.5→2→3.
- `README.md`: thêm `apps/api` (+ về sau `apps/gateway`), lệnh dev/worker mới,
  docker-compose thêm qdrant/redpanda ở GĐ2.

---

## Phụ lục A — Dev workflow sau Wave 0

```bash
pnpm dev                              # turbo: web :3000 · api :4000 · realtime :6002
pnpm --filter @cogniva/api worker     # worker BullMQ (Nest)
pnpm --filter @cogniva/api test:e2e   # e2e + contract snapshot
# Swagger: http://localhost:4000/api/docs  ·  GĐ2: docker compose up qdrant redpanda
```

## Phụ lục B — Câu hỏi mở (không chặn Wave 0)

1. Thời gian còn lại của đồ án chính xác bao nhiêu tuần? → quyết định mốc bàn
   giao nằm ở cuối GĐ1, GĐ2 hay GĐ3.
2. Email service cho forgot-password/consent (Resend free tier?) — Wave 1 cần.
3. GĐ3: số service khởi điểm — tách đủ 11 như diagram hay gộp còn 5–6
   (auth, ai+search, learning+workspace, group, billing, notification) rồi tách
   tiếp? (Khuyến nghị: gộp 5–6 trước — solo dev vận hành nổi.)
