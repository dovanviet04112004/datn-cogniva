# Redis Cache-Aside + Precompute — Lớp cache thống nhất (Tier B)

> Trạng thái: PLAN (chưa code). Mục tiêu: làm **chuẩn hệ thống lớn, đồng bộ toàn
> hệ** — 1 lớp cache áp đồng loạt mọi query đọc-nhiều, invalidation phủ đầy đủ
> mọi điểm ghi, fail-open, và **an toàn cho app RN mobile** xuyên suốt.

## 0. Nguyên tắc bất biến (áp cho MỌI domain, không ngoại lệ)

1. **Uniform** — 1 helper `cached()` + 1 key-factory `ck` + 1 module invalidate.
   Mọi domain đọc-nhiều đi qua đúng lớp này. Không cache lẻ, không chỗ có chỗ không.
2. **Complete invalidation** — mỗi cache key phải được invalidate tại **MỌI** điểm
   ghi chạm bảng dưới nó. Invalidation **co-located tại choke point** (awardXp,
   awardKarma…) để phủ-đầy-đủ-by-construction, không rải rác dễ sót.
3. **Fail-open** — Redis lỗi/chết → fallback DB, **không bao giờ làm sập trang**.
   Bám đúng pattern hiện có (rate-limit, cost-guardrail: try/catch → log warn → default an toàn).
4. **Mobile (RN) safe** —
   - Toàn bộ code cache ở `apps/web/src/lib/cache/**` (server-only, đụng `getRedis`).
     **TUYỆT ĐỐI KHÔNG** đưa redis/ioredis hay cache helper vào `packages/shared`
     (RN-safe, chỉ zod). Đã verify hiện tại shared sạch — giữ nguyên.
   - Cache đặt tại **seam lib-fn dùng chung** (route + page cùng gọi) → mobile gọi
     API route ⇒ hưởng cache server-side **miễn phí**, không import gì.
   - Mobile MUTATE qua chính API route đó ⇒ invalidation chạy server-side ⇒ mobile
     không thấy data cũ (RQ của mobile tự refetch theo staleTime).
   - `ck` (cache keys) là web-only — mobile KHÔNG cần (chỉ gọi API). Khác `qk`
     (query keys) ở shared cho RQ.
5. **Bám convention sẵn có** — key `domain:v{N}:...` (colon, có version để flush
   hàng loạt), `JSON.stringify` cho object, số lưu string, BullMQ cron cho precompute.

---

## 1. Kiến trúc — 4 module mới (tất cả `apps/web/src/lib/cache/`, server-only)

### 1.1 `cache/cache-aside.ts` — nền tảng
```ts
import { getRedis } from '@/lib/redis';
import { logger } from '@/lib/observability/logger'; // dùng logger sẵn có

/** Cache-aside fail-open. Redis lỗi ở BẤT KỲ bước nào → vẫn trả data từ fn(). */
export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;       // HIT
  } catch (err) { logger.warn('cache.read_error', { key, err: String(err) }); }
  const data = await fn();                                // MISS → nguồn thật
  try { await redis.set(key, JSON.stringify(data), { ex: ttlSec }); }
  catch (err) { logger.warn('cache.write_error', { key, err: String(err) }); }
  return data;
}

/** Xoá nhiều key (best-effort, không throw). */
export async function cacheDelete(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try { await getRedis().del(...keys); }
  catch (err) { logger.warn('cache.del_error', { keys, err: String(err) }); }
}

/** Version-bump cho cache CÔNG KHAI nhiều key tham số (library catalog).
 *  Đọc version rồi fold vào key → bump = vô hiệu hoá cả lớp mà không cần biết hết key. */
export async function cacheVersion(tag: string): Promise<number> {
  try { const v = await getRedis().get(`ver:${tag}`); return v ? Number(v) : 1; }
  catch { return 1; } // fail-open: coi như v1
}
export async function bumpCacheVersion(tag: string): Promise<void> {
  try { await getRedis().incr(`ver:${tag}`); }
  catch (err) { logger.warn('cache.bump_error', { tag, err: String(err) }); }
}
```

**Gotcha bắt buộc lưu ý:** `JSON.stringify(Date)` → ISO string; đọc lại là **string**.
Consumer có field Date phải bọc `new Date(...)` hoặc dùng normalize sẵn có
(vd `getKarmaBoard` đã bọc, study-plan dùng `normalizeItem`). Với `getUserAnalytics`
/`getLeaderboard` chỉ có number/string → không vấn đề. **Kiểm field Date từng read
trước khi wrap** (checklist Phase 1).

### 1.2 `cache/keys.ts` — `ck` factory (1 nguồn key duy nhất)
```ts
export const ck = {
  analytics:   (u: string) => `analytics:v1:${u}:30d`,
  dashboard:   (u: string) => `dashboard:v1:${u}`,
  profileMe:   (u: string) => `profile:v1:${u}`,
  wallet:      (u: string) => `wallet:v1:${u}`,
  studyPlan:   (u: string, day: string) => `study-plan:v1:${u}:${day}`,
  // public — fold version (bump khi catalog đổi)
  karmaBoard:  (ver: number) => `library:v1:karma-board:${ver}`,
  universities:(ver: number) => `library:v1:universities:${ver}`,
  courseDetail:    (id: string, ver: number) => `library:v1:course:${id}:${ver}`,
  universityDetail:(id: string, ver: number) => `library:v1:university:${id}:${ver}`,
} as const;

export const LB_XP = 'lb:xp:v1';            // ZSET — leaderboard XP
export const TAG_LIBRARY = 'library:catalog'; // version tag cho catalog public
```

### 1.3 `cache/invalidate.ts` — invalidator theo domain (gọi tại choke point)
```ts
import { cacheDelete, bumpCacheVersion } from './cache-aside';
import { ck, TAG_LIBRARY } from './keys';
import { lbIncr } from './leaderboard';

/** XP/streak đổi → gọi BÊN TRONG awardXp (choke point duy nhất). */
export async function onXpChanged(userId: string, xpDelta: number) {
  await lbIncr(userId, xpDelta);                          // ZSET atomic
  await cacheDelete(ck.dashboard(userId), ck.profileMe(userId));
}
/** Doc/conversation/flashcard count đổi (không qua awardXp). */
export async function onDashboardChanged(userId: string) {
  await cacheDelete(ck.dashboard(userId));
}
/** Assistant message mới (cost) → analytics cũ. */
export async function onAnalyticsChanged(userId: string) {
  await cacheDelete(ck.analytics(userId));
}
/** Karma đổi → gọi BÊN TRONG awardKarma. */
export async function onKarmaChanged() { await bumpCacheVersion(TAG_LIBRARY); }
/** Doc publish/import/remix → catalog public cũ. */
export async function onLibraryCatalogChanged() { await bumpCacheVersion(TAG_LIBRARY); }
/** Study-plan write (toggle/skip/delete/create/materialize). */
export async function onStudyPlanChanged(userId: string, day: string) {
  await cacheDelete(ck.studyPlan(userId, day));
}
/** Wallet write (nạp/trừ/promo). */
export async function onWalletChanged(userId: string) { await cacheDelete(ck.wallet(userId)); }
```

### 1.4 `cache/leaderboard.ts` — ZSET cho XP leaderboard (precompute đúng chuẩn lớn)
```ts
import { getRedis } from '@/lib/redis';
import { LB_XP } from './keys';
import { logger } from '@/lib/observability/logger';

/** Cộng XP atomic vào ZSET (gọi trong awardXp). Fail-open. */
export async function lbIncr(userId: string, delta: number) {
  try { await getRedis().zincrby(LB_XP, delta, userId); }
  catch (err) { logger.warn('lb.incr_error', { userId, err: String(err) }); }
}
/** Top N userId+score. Null/empty → caller backfill từ DB. */
export async function lbTop(n: number): Promise<Array<{ userId: string; xp: number }> | null> {
  try {
    const flat = await getRedis().zrevrange(LB_XP, 0, n - 1, true); // [id,score,...]
    const out: Array<{ userId: string; xp: number }> = [];
    for (let i = 0; i < flat.length; i += 2) out.push({ userId: flat[i]!, xp: Number(flat[i + 1]) });
    return out;
  } catch (err) { logger.warn('lb.top_error', { err: String(err) }); return null; }
}
/** Backfill ZSET từ userStats (lazy khi cold + BullMQ reconcile). */
export async function lbBackfill(rows: Array<{ userId: string; xp: number }>) {
  // pipeline zincrby reset: zrem all? đơn giản zadd-style qua zincrby từ 0 không an toàn.
  // → dùng eval Lua DEL + ZADD batch (atomic). Chi tiết Phase 3.
}
```

---

## 2. Bản đồ READ — domain × key × TTL × strategy (ĐẦY ĐỦ, không sót)

| # | Domain | Seam (lib-fn) | Scope | Cost | Strategy | Key / ZSET | TTL | Mobile route |
|---|---|---|---|---|---|---|---|---|
| 1 | **user-analytics** ⭐ | `lib/analytics/get-user-analytics.ts` | per-user | **heavy** | cache-aside | `ck.analytics(u)` | 300s | `/api/analytics` |
| 2 | **xp-leaderboard** ⭐ | `lib/leaderboard/get-leaderboard.ts` | public | light(hot) | **ZSET** + hydrate | `LB_XP` | — (live) | `/api/leaderboard` |
| 3 | **dashboard-stats** | *(extract)* `lib/dashboard/get-dashboard-stats.ts` | per-user | light | cache-aside | `ck.dashboard(u)` | 60s | — (SSR only) |
| 4 | **wallet** | `lib/tutoring/wallet.ts` | per-user | light | cache-aside | `ck.wallet(u)` | 30s | `/api/wallet` |
| 5 | **library-universities** | `lib/library/get-universities-directory.ts` | public | light | cache-aside (←từ unstable_cache) | `ck.universities(ver)` | 3600s | — |
| 6 | **library-karma-board** | `lib/library/get-karma-board.ts` | public | light | cache-aside (←từ unstable_cache) | `ck.karmaBoard(ver)` | 300s | — |
| 7 | **library-course/university detail** | *(extract)* page `course/[id]`, `university/[id]` | public | light | cache-aside | `ck.courseDetail(id,ver)`… | 3600s | — |
| 8 | **profile-streak** | `/api/profile/me` (StreakBadge) | per-user | light | cache-aside | `ck.profileMe(u)` | 120s | `/api/profile/me` |
| 9 | **study-plan** | `lib/study-plan/query.ts` + `materialize.ts` | per-user | light* | cache-aside | `ck.studyPlan(u,day)` | 60s | `/api/study-plan*` |

⭐ = ưu tiên cao nhất (heavy hoặc hot). `*` study-plan: phần nặng (`proposeForToday`)
đã chạy 1 lần/ngày nhờ materialize idempotent → cache giá trị thấp, nhưng **vẫn làm
để đồng bộ** (yêu cầu "không chỗ có chỗ không").

**Ghi chú seam vàng:** #1,2,4,9 đã nằm sau lib-fn dùng chung route+page → mobile
hưởng ngay. #3,7 đang inline trong page → **phải extract lib-fn trước** (đồng thời
giúp mobile sau này có endpoint dùng lại). #5,6 đang `unstable_cache` (Next) → **đổi
sang Redis `cached()`** để toàn hệ DÙNG MỘT cơ chế + có invalidation thật (unstable_cache
hiện chỉ TTL, không bust được khi có doc mới).

---

## 3. Đồ thị INVALIDATION — mọi điểm ghi → invalidator (phủ ĐẦY ĐỦ)

| Cache domain | Choke point / điểm ghi (file) | Mobile-reachable | Gọi invalidator |
|---|---|---|---|
| xp-leaderboard + profile + dashboard(xp) | **`lib/gamification/xp.ts › awardXp()`** (gọi từ quiz attempt, flashcard review, doc upload, note create) | ✓ (qua API) | `onXpChanged(u, delta)` — **1 chỗ phủ hết 4+ route** |
| dashboard (count) | `api/documents/upload` (doc++) | ✓ | `onDashboardChanged(u)` (+ upload đã gọi awardXp) |
| dashboard (count) | `api/chat` (conversation++/message++) | ✓ | `onDashboardChanged(u)` + `onAnalyticsChanged(u)` |
| dashboard (count) | `api/flashcards` create (flashcard++) | ✓ | `onDashboardChanged(u)` |
| user-analytics | `api/chat` (insert ASSISTANT message + metadata cost) | ✓ | `onAnalyticsChanged(u)` |
| user-analytics | `api/rooms/[id]/ai-message` (roomMessage cost) | ✓ | `onAnalyticsChanged(u)` *(xác minh analytics có gộp roomMessage không — Phase 2 task)* |
| karma-board + library-catalog | **`awardKarma()`** (gọi từ import +1, remix +5, endorse +10, purchase +10, quality +20) | ✓ | `onKarmaChanged()` — **1 chỗ phủ 5 nguồn** |
| library-catalog | `api/library/docs/finalize` (publish), `…/import` (count++), `api/library/remix` (doc mới) | ✓ | `onLibraryCatalogChanged()` |
| study-plan | `materialize.ts`, `POST /api/study-plan`, `PATCH/DELETE /api/study-plan/[id]`, `POST …/[id]/skip` | ✓ | `onStudyPlanChanged(u, today)` tại 5 điểm |
| wallet | các route nạp/trừ ví (booking pay, payout, promo) | ✓ | `onWalletChanged(u)` |

**Tài sản lớn:** `awardXp` và `awardKarma` là **choke point tập trung** → chỉ cần
hook 2 hàm này là phủ XP-leaderboard/profile/karma cho **mọi** route gọi chúng
(quiz/flashcard/upload/note/import/remix/endorse/purchase/quality). Đây là điểm khiến
"phủ đầy đủ" khả thi mà không rải rác. Các count dashboard + analytics + study-plan +
wallet không qua choke point chung → hook tại từng route create tương ứng (đã liệt kê hết ở trên).

---

## 4. Precompute (BullMQ cron) — chống drift + giảm tải nền

- **`reconcile-leaderboard`** (cron ví dụ `*/30 * * * *` hoặc nightly): rebuild ZSET
  `LB_XP` từ `userStats` (DEL + ZADD batch qua Lua) → sửa lệch do miss/restart/fail-open.
  Mẫu có sẵn: `jobs/tutoring-recurring-rollout.ts`.
- **(Tuỳ chọn, sau)** `rollup-analytics` nightly → bảng summary `ai_usage_daily`
  (userId, day, messages, tokens, cost) để `getUserAnalytics` đọc O(1) thay vì scan
  metadata 30 ngày. Đây là "precompute thật" (nguyên tắc #4 hệ thống lớn) — để Phase 5+,
  cần migration schema, không gấp.

---

## 5. Phasing (làm theo thứ tự, mỗi phase typecheck xanh + không đổi behavior nếu Redis off)

- **✅ Phase 0 — Foundation (XONG 2026-06-02, không đổi hành vi)**: đã tạo 4 module
  `apps/web/src/lib/cache/*` — `cache-aside.ts` (`cached`/`cacheDelete`/`cacheVersion`/
  `bumpCacheVersion`, fail-open, robust string-vs-object cho ioredis vs Upstash),
  `keys.ts` (`ck` + `LB_XP` + `TAG_LIBRARY`), `invalidate.ts` (8 invalidator), `leaderboard.ts`.
  Typecheck web xanh; `packages/shared` verify sạch redis (RN-safe giữ nguyên).
  **Phát hiện (đã xử lý ở Phase 3):** `@upstash/redis@1.38.0` KHÔNG có `zrevrange` (chỉ `zrange`+`{rev}`),
  IoRedisAdapter/InMemory chỉ có `zrevrange` → giải bằng helper `zRevRangeWithScores` branch instanceof.
- **✅ Phase 1+2 — Wrap reads + invalidation (ghép cặp, FULL 9/9 domain, 2026-06-02)**:
  - ✅ **analytics** (#1): `cached(ck.analytics, 300)`; invalidate `onAnalyticsChanged` tại chat
    ASSISTANT insert. roomMessage KHÔNG vào analytics (query chỉ join message→conversation) → N/A.
  - ✅ **library karma-board (#6)+universities (#5)**: `unstable_cache`→`cached()` (300s/3600s),
    ĐƠN-KEY+`cacheDelete`. Invalidate `onKarmaChanged`@awardKarma + `onLibraryCatalogChanged`@finalize.
  - ✅ **profile/me (#8)**: `cached(ck.profileMe, 120)`; invalidate `onProfileChanged`@PATCH + onXpChanged.
  - ✅ **dashboard (#3)**: extract `lib/dashboard/get-dashboard-stats.ts` → `cached(ck.dashboard, 60)`
    (dbReplica, re-hydrate Date). Invalidate: onXpChanged (review/quiz/note/upload) + `onDashboardChanged`
    @chat(conversation mới)+flashcard create (route + generate).
  - ✅ **wallet (#4)**: `getWallet` → `cached(ck.wallet, 30)` (re-hydrate promoExpiresAt Date,
    expiry-reset GIỮ ngoài cache). Invalidate `onWalletChanged` sau MỖI transaction (charge/topup/
    credit/refund/promo — đều trong wallet.ts, choke point). Mutation đọc bằng SELECT FOR UPDATE
    (không cache) nên tiền luôn tươi; cache chỉ hiển thị.
  - ✅ **study-plan (#9)**: `materializeProposalForToday` → `cached(ck.studyPlan(u,day), 60)` (day=
    `studyPlanDayKey()` local). Invalidate `onStudyPlanChanged` @POST/PATCH/DELETE/skip. Date→string
    OK vì consumer đều normalizeItem/JSON.
  - ✅ **course/university detail (#7)**: extract `lib/library/get-catalog-detail.ts` → `cached`
    VERSION-FOLD `ck.courseDetail/universityDetail(id, ver)` (ver từ TAG_LIBRARY). Invalidate qua
    `onLibraryCatalogChanged` (`bumpCacheVersion(TAG_LIBRARY)`) @finalize.
  - ✅ **awardXp choke point**: `onXpChanged` cuối `awardXp` → profile+dashboard+ZSET cho mọi route XP.
  - **Date-serialization kiểm từng read** + re-hydrate ở nơi type cần Date thật (dashboard recentDocs,
    wallet promoExpiresAt). karma-board/study-plan để string vì consumer normalize/JSON.
- **✅ Phase 3 — Leaderboard ZSET (2026-06-02)**: thêm `zRevRangeWithScores(key,n)` portable vào
  `redis.ts` (branch instanceof: adapter→`zrevrange`; Upstash→`zrange`+`{rev,withScores}`). `lbIncr`
  đã cộng ZSET trong awardXp (qua onXpChanged). `lbTop` đọc ZSET; `lbBackfill` DEL+ZADD batch qua Lua
  eval (InMemory không eval → fail-open). `getLeaderboard` ZSET-first + hydrate user + lọc isPublic
  (buffer ×3) + lazy backfill (fire-and-forget); fallback DB gốc nếu ZSET cold/lỗi. BullMQ
  `reconcile-leaderboard` cron `*/30 * * * *` rebuild ZSET chống drift (đã register ở queue cron).
  **Smoke-test dev Redis OK** (Lua rebuild → ZREVRANGE đúng thứ tự; ZINCRBY re-rank đúng).
  ⚠️ Giới hạn đã biết: nếu top 3×N ZSET toàn private → có thể under-return (hiếm; tăng buffer nếu cần).
- **Phase 4 — Verify**: typecheck web+shared; test fail-open (tắt Redis → trang vẫn
  chạy, chỉ chậm hơn); test staleness (mutate → reload thấy mới); kiểm `/api/health`
  vẫn báo redis mode đúng.
- **Phase 5 (tuỳ chọn)** — analytics rollup table + read-replica.

---

## 6. Rủi ro & guardrail (chuẩn lớn)

| Rủi ro | Guardrail |
|---|---|
| Redis chết → sập trang | **Fail-open mọi nơi** (đã thiết kế); test bằng tắt REDIS_URL |
| Data cũ (sót invalidation) | Choke-point hook + **checklist §3**; TTL ngắn làm lưới an toàn cuối |
| Cache poisoning / sai shape sau đổi code | **version trong key** (`v1`) — bump để flush sạch toàn bộ tức thì |
| Date→string khi serialize | Checklist Phase 1; tái dùng normalize sẵn có |
| Thundering herd lúc TTL hết (analytics heavy) | (tuỳ chọn) single-flight: `set nx` lock 5s quanh fn(); hoặc dựa BullMQ rollup |
| ZSET lệch số với DB | BullMQ `reconcile-leaderboard` định kỳ rebuild |
| Mobile thấy số cũ | invalidation server-side chạy khi mobile mutate qua API; RQ mobile refetch theo staleTime |
| Rò Redis vào shared (vỡ RN) | **Lint/review gate**: cache code chỉ `apps/web/src/lib/cache`; CI grep chặn import redis trong packages/shared |

---

## 7. Mobile (RN) — tóm tắt ràng buộc (đọc kỹ trước khi dev mobile)

1. Mobile **không** import gì từ `cache/*` — chỉ gọi API route. Cache nằm sau route.
2. Cache đặt tại **seam lib-fn** mà route gọi → mobile hưởng cache + invalidation tự động.
3. `packages/shared` PHẢI sạch redis (giữ RN-safe). `ck` ở web, `qk` ở shared.
4. Khi viết endpoint mới cho mobile, **gọi qua lib-fn đã cache** (đừng query DB thẳng
   trong route) → mobile + web đồng nhất 1 nguồn + 1 cache.
5. Read-your-write trên mobile: route mutate → invalidate → mobile RQ `invalidateQueries`
   sau mutation (đã là pattern RQ migration) → thấy data mới.

---

## 8. Việc cụ thể (checklist thực thi)

**Phase 0:** [x] cache-aside.ts [x] keys.ts [x] invalidate.ts [x] leaderboard.ts (lbIncr; lbTop/lbBackfill stub Phase 3)
**Phase 1:** [x] analytics [x] dashboard(extract+cache) [x] wallet [x] profile/me
[x] study-plan [x] universities(→redis) [x] karma-board(→redis) [x] course/university detail(extract+cache)
**Phase 2 (invalidation — đối chiếu §3):** [x] awardXp(onXpChanged) [x] awardKarma(onKarmaChanged) [x] chat(onAnalyticsChanged+onDashboardChanged)
[x] upload(qua onXpChanged) [x] flashcard create(onDashboardChanged ×2: route+generate) [—] rooms ai-message (N/A) [x] study-plan ×4(POST/PATCH/DELETE/skip) [x] wallet ×5(charge/topup/credit/refund/promo)
[x] library finalize(onLibraryCatalogChanged) [x] profile PATCH(onProfileChanged)
**Phase 3:** [x] lbIncr in awardXp(qua onXpChanged) [x] zRevRangeWithScores portable(redis.ts) [x] getLeaderboard ZSET+hydrate [x] backfill(Lua) [x] reconcile cron(register)
**Phase 4:** [ ] typecheck [ ] fail-open test [ ] staleness test [ ] health check

---

## 9. Tier 2 — Database (làm TRƯỚC phần cache, ROI cao hơn cache)

> Nguyên tắc hệ thống lớn: "trang chậm → check INDEX trước tiên". Cache chỉ giảm
> tần suất; index sửa GỐC. Với analytics phải **thêm index trước, cache sau** —
> nếu chỉ cache, mỗi cache-miss vẫn full-scan + đập primary.

### 9.0 Trạng thái (đã audit `packages/db/src/index.ts` + `schema.ts`)
| Hạng mục | Trạng thái |
|---|---|
| Connection pooling (Vercel trap) | ✅ **Chuẩn** — postgres.js + Neon Pooler `?pgbouncer=true` + `prepare:false` + pool lean (max 10/15, idle 20s, lifetime 30m) + lazy Proxy |
| Read replica | ✅ Plumbing có (`dbReplica`, `DATABASE_REPLICA_URL` fallback primary, region-aware scaffolding) ⚠️ heavy read **chưa route sang** |
| N+1 | ✅ Pattern tốt (join + `inArray` batch + Map hydrate, vd `propose.ts`) |
| Index | ✅ 145 index, hot paths phủ tốt **⚠️ TRỪ `conversation` + `message`** |

### 9.1 ✅ P0 — Index `conversation` + `message` (ĐÃ LÀM 2026-06-02)
**Câu chuyện thật (đính chính audit ban đầu):** migration `0002_hot_path_indexes.sql`
ĐÃ khai báo 2 index này (§6 của file đó) nhưng **chưa bao giờ áp được lên DB**:
- `conversation_user_updated_idx` trỏ cột `updated_at` — bảng `conversation` KHÔNG có
  cột đó (chỉ `created_at`) ⇒ statement LỖI khi apply.
- DB dev dựng bằng `db:push` từ `schema.ts` (vốn chưa khai báo index) → verify
  `pg_indexes`: cả `conversation` lẫn `message` **chỉ có primary key**. Đúng là đang seq-scan.

**Đã fix (2 lớp, đồng bộ):**
1. `schema.ts` — thêm block `(t) => ({...})` cho cả 2 bảng (nguồn sự thật cho `db:push`
   tương lai): `message_conv_created_idx` on `(conversationId, createdAt)` +
   `conversation_user_created_idx` on `(userId, createdAt)` — dùng `createdAt` (cột tồn tại),
   KHÔNG phải `updated_at`.
2. Migration tay `0056_chat_hot_path_indexes.sql` — `CREATE INDEX CONCURRENTLY IF NOT EXISTS`
   (style 0002, prod-safe, idempotent). Áp local qua `bash packages/db/scripts/apply-raw-mig.sh
   0056_chat_hot_path_indexes.sql` (docker psql autocommit — CONCURRENTLY cần autocommit).

**Verify (EXPLAIN ANALYZE query analytics):** `message` giờ dùng
`Index Scan using message_conv_created_idx` (Index Cond: conversation_id + created_at) —
hết seq-scan trên bảng lớn nhất. `conversation` còn Seq Scan **chỉ vì 25 row** (planner
chọn đúng ở scale nhỏ); index có sẵn, tự bật khi bảng lớn.

> ⚠️ **Bài học quy trình:** repo này KHÔNG dùng `drizzle-kit generate` — `_journal.json`
> cố tình đóng băng ở idx 1, mọi migration 0002→0056 **viết tay** rồi apply qua
> `scripts/apply-raw-mig.sh` (docker psql). Chạy `db:generate` sẽ diff với snapshot cũ →
> đẻ ra migration "tạo lại 101 bảng" vô dụng + bẩn journal. **Luôn viết tay migration mới.**

> ⚠️ **Nợ kỹ thuật cần dọn:** statement `conversation_user_updated_idx` trong
> `0002_hot_path_indexes.sql` vẫn còn (trỏ cột không tồn tại) → ai apply 0002 sạch sẽ
> dính lỗi. Nên sửa/bỏ dòng đó trong 0002 khi có dịp (chưa làm, không gấp vì 0002 đã qua).

### 9.2 ✅/◐ P1 — Route heavy read sang `dbReplica` (4/6 ĐÃ LÀM 2026-06-02)
`dbReplica` fallback trong suốt về primary khi chưa có `DATABASE_REPLICA_URL` → đổi an toàn,
local là no-op, tự kích hoạt khi prod cấu hình replica.
- ✅ `lib/analytics/get-user-analytics.ts` (3× `dbReplica.execute`)
- ✅ `lib/leaderboard/get-leaderboard.ts`
- ✅ `lib/library/get-universities-directory.ts` (3× select)
- ✅ `lib/library/get-karma-board.ts` (3× select)
- ◐ dashboard stats + library course/university detail — **CHƯA** (còn inline trong page,
  phải extract lib-fn trước; làm cùng Phase 1 cache §2 #3,#7).
- **KHÔNG đổi**: study-plan materialize (insert), wallet (đọc-sau-ghi), bất cứ read trong cùng tx với write.
- Typecheck web+db: xanh.

> Kết hợp với cache: thứ tự xử lý 1 read = **Redis cache → (miss) dbReplica → (no replica) primary**. Cả 3 fail-open.

### 9.3 P2 — Verify env prod
- [ ] `DATABASE_URL` trỏ endpoint **`-pooler`** của Neon (không phải direct) — nếu không, mất pooling dù code sẵn sàng.
- [ ] `DATABASE_REPLICA_URL` đã provision (nếu chưa, §9.2 vẫn chạy nhưng fallback primary → không giảm tải).

### 9.4 Thứ tự tổng (ROI giảm dần) & Mobile
**Thứ tự:** 9.1 (index, rẻ + sửa gốc) → 9.2 (replica routing) → §1-8 (Redis cache) → precompute (ZSET/rollup).
**Mobile:** toàn bộ Tier 2 là server-side (index/pool/replica) → mobile hưởng tự động qua API, không cần làm gì riêng; `packages/shared` không đụng.

**Checklist Tier 2:** [x] index message+conversation (schema.ts + 0056) [x] migration CONCURRENTLY [x] EXPLAIN verify (message dùng index) [x] route 4 heavy reads → dbReplica [ ] extract+route dashboard/detail (◐ cùng Phase 1 cache) [ ] verify DATABASE_URL pooler (prod) [ ] verify replica provisioned (prod)

---

## 10. Wave 2 — Coverage TOÀN APP (2026-06-02, "không bỏ sót")

Sau khi xong §1-9 (9 domain plan gốc), user yêu cầu phủ MỌI read đáng cache. Quy trình:
**audit song song (workflow) → ~20 gap → implement song song (workflow 12 agent, file rời) →
adversarial verify (workflow 11 skeptic) → fix gap thật → runtime verify.**

### 10.1 Thêm cache (ngoài 9 domain gốc)
App-shell/heavy: workspaces list/stats/atoms · documents list · flashcard-stats · exams list ·
groups list/detail/members/unread · rooms list/recordings · chat conversations list.
Public: library docs-feed (filterHash, **chỉ cache khi q rỗng**) / doc-detail / hub-stats.
Per-user/khác: profile-public · graph · tutoring mine/tutors/requests.
Replica-only (6 read on-demand, không cache): channels/search/invites/global-search/chunks/chat-detail.

### 10.2 Invalidator fan-out mới (đều ở invalidate.ts)
onWorkspaceChanged · onWorkspaceContentChanged · onDocumentChanged(fan-out documents+workspaces+
graph+dashboard+wsStats) · onFlashcardChanged · onExamChanged · onGroupChanged · onGroupMembershipChanged ·
onGroupReadChanged · onRoomChanged · onRoomRecordingsChanged · onConversationsChanged · onTutoringMineChanged ·
onGraphChanged · **onMasteryChanged** (hook tại choke point `applyAttempt` → phủ quiz/flashcard/exam/grade) ·
onLibraryImportChanged (chỉ hub-stats, KHÔNG nuke catalog version vì import thường xuyên).

### 10.3 Adversarial verify → 11 gap THẬT đã fix (impl agent sót)
DELETE flashcard/conversation · exam duplicate + generate-questions · group mute + roles ·
admin recording delete · **library doc DELETE** (xem doc đã ẩn 10ph qua cache — critical) ·
admin user isPublic PATCH · **mastery→graph**. 2 false-positive bỏ qua: exams "leak" (joined không lọc
ws — pre-existing, per-user key nên không lộ chéo); library filterHash (route không parse các filter đó).
Graph authz verify ĐÚNG (guard ngoài cache).

### 10.4 ✅ Phase 4 — Runtime verify (dev server thật)
- App boot sạch (`✓ Ready 4.7s`). Key cache populate đúng khi curl: `library:v1:universities`,
  `library:v1:docs:{filterHash}:ver`. TTL đúng (3539/3600s).
- **Fail-open OK** (docker stop redis → endpoint vẫn 200 từ DB).
- **⚠️ Bug fail-open phát hiện + đã sửa:** ioredis mặc định treo **~21s/request** khi redis down →
  thêm `enableOfflineQueue:false` + `commandTimeout/connectTimeout:1000` + `maxRetriesPerRequest:1`
  vào `redis.ts` → đo lại **0.43s**. Sống còn cho prod (tránh cascade timeout toàn app khi Redis sự cố).

**Checklist Wave 2:** [x] audit toàn app [x] implement ~20 domain [x] central keys+invalidator
[x] adversarial verify + fix 11 gap [x] runtime verify (boot+key+TTL+fail-open) [x] fix fail-open latency
