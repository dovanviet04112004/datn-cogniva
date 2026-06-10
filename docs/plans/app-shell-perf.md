# Plan: Tăng tốc trang `(app)` — trị "session-in-layout"

> Trạng thái: **PLAN (chưa code)**. Mục tiêu: trang `(app)` nhanh **kể cả prod**, làm
> **chuẩn hệ thống lớn**, **KHÔNG phá cấu trúc dự án**, **KHÔNG phá app mobile** (Expo RN),
> **tích hợp đúng** với lớp Redis cache + React Query đã làm.
> Nguồn: research workflow 8 hướng (2026-06-02) — convergence rõ ràng giữa các agent.

---

## 0. Ràng buộc bất biến (áp xuyên suốt)
1. **Không phá cấu trúc** — không refactor 100+ page, không "rip session ra client".
2. **Không phá mobile** — Expo dùng Bearer JWT + SecureStore, ĐỘC LẬP với cookie web;
   chỉ share `packages/shared` (RN-safe). Mọi thay đổi web KHÔNG được đổi API signature
   / token format / auth-client interface. Mobile không có Next layout nên thay đổi
   layout web = mobile zero-impact.
3. **Tích hợp lớp đã có** — Redis 3-mode (`lib/redis.ts`, `getRedis()`, đã fail-open
   nhanh sau fix `enableOfflineQueue:false`), cache-aside (`lib/cache/*`), React Query
   v5 + IndexedDB persist (`qk` ở `packages/shared`).
4. **Fail-open** — Redis/cache lỗi → fallback DB, không bao giờ sập trang.

---

## 1. Chẩn đoán (đã verify bằng code, không đoán)

**Gốc:** `apps/web/src/app/(app)/layout.tsx:33` gọi `auth.api.getSession({ headers })`:
- `headers()` ở layout → **ÉP mọi route con `(app)` sang dynamic** (PPR off → `revalidate`/ISR vô tác dụng).
- Mỗi request → **query session vào Neon** (Singapore: ~50-100ms warm, **+1-2s cold-start**).

**Chi tiết then chốt:**
| Phát hiện | Evidence |
|---|---|
| Layout dùng getSession CHỈ để lấy `currentUserId` cho ChatDockProvider (DATA, **không phải gate**) | `(app)/layout.tsx:33,40` |
| **Middleware ĐÃ làm auth GATE** bằng `getSessionCookie` (cookie presence, edge, no DB) → layout getSession **thừa** cho việc chặn | `middleware.ts:124-187` |
| **42 file** gọi getSession riêng (layout + AppTopbar + 20+ page + nested layout groups/messages + admin guard) — không dedup, không cache | grep toàn `(app)` |
| AppTopbar (server) gọi getSession ĐỘC LẬP (trùng layout) | `components/app/topbar.tsx:26-27` |
| nested `groups/[id]/layout.tsx` còn +3 DB query nữa ở cấp layout | `groups/[id]/layout.tsx:33,56-76` |
| **Better Auth 1.6.10**: `cookieCache` (5min) BẬT ✓ nhưng **`secondaryStorage` CHƯA cấu hình** → cookie-cache miss vẫn đập Neon | `lib/auth.ts:144-147` (không có secondaryStorage); installed `better-auth@1.6.10` |
| Redis + RQ đã có nhưng **CHƯA dùng cho session** | `lib/cache/keys.ts` (không có key session) |
| 50+ page `force-dynamic`, **0 Suspense boundary** → chưa sẵn cho PPR | grep `(app)/**` |

**Kết luận:** thủ phạm chính = (a) session lookup đập Neon mỗi request (thiếu `secondaryStorage`),
(b) headers-in-layout chặn PPR. (a) rẻ + đòn bẩy lớn; (b) đắt hơn + đụng cấu trúc.

---

## 2. Chiến lược — 4 TẦNG (ROI giảm, rủi ro tăng)

### ✅ Tầng 1 — Session vào Redis qua Better Auth `secondaryStorage` ⭐ (rủi ro THẤP, đòn bẩy LỚN nhất)
**Đây là cách CHUẨN Better Auth để scale session** (1.6.10 hỗ trợ; dùng nội bộ ở
`internal-adapter` + `create-context` + rate-limiter). Cấu hình 1 adapter Redis →
Better Auth **lưu + đọc session ở Redis (1-5ms)** thay Neon.

**Làm gì:**
1. Tạo `apps/web/src/lib/auth-secondary-storage.ts`:
   ```ts
   import { getRedis } from '@/lib/redis';
   import { logger } from '@/lib/observability/logger';
   /** Adapter Redis cho Better Auth secondaryStorage. Fail-open: lỗi → trả null/no-op
    *  → Better Auth tự fallback DB (storeSessionInDatabase=true). Server-only. */
   export const redisSecondaryStorage = {
     async get(key: string): Promise<string | null> {
       try { return (await getRedis().get(`ba:${key}`)) as string | null; }
       catch (e) { logger.warn('auth.ss.get_error', { key, e: String(e) }); return null; }
     },
     async set(key: string, value: string, ttl?: number): Promise<void> {
       try { await getRedis().set(`ba:${key}`, value, ttl ? { ex: ttl } : undefined); }
       catch (e) { logger.warn('auth.ss.set_error', { key, e: String(e) }); }
     },
     async delete(key: string): Promise<void> {
       try { await getRedis().del(`ba:${key}`); }
       catch (e) { logger.warn('auth.ss.del_error', { key, e: String(e) }); }
     },
   };
   ```
   (Verify chữ ký interface `{ get, set, delete }` từ `better-auth/db` lúc code — đã thấy dùng nội bộ.)
2. `apps/web/src/lib/auth.ts`: thêm vào `betterAuth({...})`:
   ```ts
   secondaryStorage: redisSecondaryStorage,
   session: {
     ...hiện có (cookieCache 5min GIỮ NGUYÊN),
     storeSessionInDatabase: true, // giữ DB làm backup → Redis wipe KHÔNG logout toàn bộ
   },
   ```

**Vì sao ăn:**
- Phủ **TẤT CẢ 42 getSession site** tự động (layout/page/API) — không đụng từng chỗ.
- **Mobile hưởng luôn** (mobile getSession qua API route cũng đọc Redis). Bearer JWT flow không đổi.
- **Invalidation TỰ ĐỘNG**: Better Auth tự ghi/xoá session ở secondaryStorage khi
  signin/signout/revoke (qua internal-adapter) → **không cần wire tay** (khác cache-aside thủ công).
- **Bonus**: rate-limit của Better Auth cũng chuyển sang Redis (đang dùng secondaryStorage).
- Kết hợp `cookieCache` 5min: trong cửa sổ đó getSession đọc **signed cookie** (0 DB, 0 Redis);
  hết cửa sổ → đọc **Redis** (1-5ms) thay Neon (50-100ms/1-2s).

**Rủi ro:** thấp. Không đụng layout/page/mobile/cấu trúc. ~35 dòng, 2 file.
**Verify:** đếm session đọc Redis vs Neon (kỳ vọng >90% Redis/cookie); đo TTFB trang `(app)`.

---

### ✅ Tầng 2 — Dedup getSession trong 1 request + gỡ getSession thừa ở layout (rủi ro THẤP)
**Vấn đề:** 1 lần tải trang = layout + AppTopbar + page + nested layout = **3-5 lần** resolve session
(dù Tầng 1 đã rẻ, vẫn thừa N round-trip Redis).

**Làm gì:**
1. Tạo `apps/web/src/lib/auth-server.ts`:
   ```ts
   import { cache } from 'react';
   import { headers } from 'next/headers';
   import { auth } from '@/lib/auth';
   /** Request-scoped memo: trong CÙNG 1 request, layout+topbar+page share 1 lần resolve. */
   export const getServerSession = cache(async () =>
     auth.api.getSession({ headers: await headers() }));
   ```
   `react.cache()` dedup theo request (chuẩn Next App Router). Tầng 1 lo phần "rẻ", Tầng 2 lo "ít lần".
2. Đổi call site (layout + AppTopbar + nested layout + hot pages) sang `getServerSession()`.
   Còn 42 chỗ đổi DẦN — không bắt buộc 1 lần (mỗi chỗ đổi là 1 dedup thêm).
3. **Gỡ getSession thừa ở layout**: vì middleware đã gate, layout chỉ cần `currentUserId` cho
   ChatDockProvider → lấy từ `getServerSession()` (đã dedup + Redis-backed). KHÔNG đổi behavior
   bảo mật (gate vẫn ở middleware + child pages vẫn validate per-route).

**Rủi ro:** thấp (cùng contract, chỉ thêm memo). Không phá mobile/cấu trúc.

---

### ✅ Tầng 3 — React Query: `useMe` hook + post-mutation sync (rủi ro THẤP, UX nhất quán)
Dữ liệu user phía CLIENT (avatar, plan, streak) đang fetch rời rạc (StreakBadge/UserMenu/ChatDock
mỗi cái 1 useQuery `qk.profileMe`). Hợp nhất + cập nhật tươi sau mutation.

**Làm gì:**
1. `packages/shared/src/query/use-me.ts` → `useMe()` (gọi `apiGet('/api/profile/me')`, key
   `qk.profileMe()`). **RN-safe** (chỉ apiGet + qk) → web + mobile dùng chung. Gom StreakBadge/UserMenu/ChatDock.
2. Post-mutation `qc.setQueryData(qk.profileMe(), updated)` sau khi XP/profile đổi → tươi ngay,
   khỏi reload. (Bổ trợ server-side `onProfileChanged`/`onXpChanged` đã có.)

**Tích hợp:** client-user-data đi qua RQ+IndexedDB (đã có); server-session đi qua Tầng 1+2. 2 lớp bổ trợ, không chồng.
**Rủi ro:** thấp. Mobile hưởng (hook ở shared).

---

### ⚠️ Tầng 4 — PPR / vỏ tĩnh (rủi ro CAO HƠN, cho first-load prod) — **DUYỆT RIÊNG**
Sau Tầng 1-3, session lookup đã rẻ (~5ms) nên dynamic render đã nhẹ. Tầng 4 là bước "vỏ tĩnh
từ CDN" — first-load prod nhanh thật sự. Đây là phần **đụng cấu trúc**, làm sau + duyệt riêng.

**Cách an toàn nhất (route segmentation):**
- Tạo nested `apps/web/src/app/(app)/(authenticated)/layout.tsx` chứa phần phụ thuộc session
  (sidebar cá nhân hoá, banner). Outer `(app)/layout.tsx` giữ **nông** (KHÔNG getSession/headers).
- Page gần-công-khai (library, leaderboard) ra ngoài `(authenticated)` → **static/ISR-eligible**.
- Middleware vẫn gate trước khi tới `(authenticated)`.

**Hoặc bật PPR thật:** `ppr: true` trong `next.config.mjs` + bọc phần động (greeting, banner)
trong `<Suspense fallback={skeleton}>` → vỏ tĩnh prerender + stream phần động.

**Rủi ro:** đụng file structure + cần Suspense fallback + PPR experimental. → **Phase riêng, đo Tầng 1-3 trước rồi quyết.**

---

## 3. KHÔNG làm (đã loại — có lý do, nhiều agent cảnh báo)
- ❌ **Rip session ra client** (ChatDock `useEffect` + `useSession`): hydration mismatch (radix IDs
  lệch SSR vs client), flicker user-menu, mất personalization server-side. (Option A/C — high risk.)
- ❌ **Refactor 100+ page** bỏ getSession: surface khổng lồ, rủi ro vỡ feature.
- ❌ **Better Auth custom session plugin** thay secondaryStorage: undocumented, high risk — dùng
  `secondaryStorage` chính thức (đã hỗ trợ) thay thế.
- ❌ **`unstable_cache` wrap getSession**: per-instance (không share đa-instance), API unstable, vẫn dynamic.
- ❌ **Lift session lên ROOT layout**: làm dynamic TOÀN BỘ app (cả marketing), không chỉ `(app)`.

---

## 4. Mobile-safety (xuyên suốt — đã verify)
- Mobile: Bearer JWT + SecureStore, `credentials:'omit'`, share `packages/shared` RN-safe.
- Tầng 1 (`secondaryStorage`) = server-side → mobile getSession qua API cũng hưởng Redis, **không
  đổi Bearer flow** (`auth.ts` bearer plugin `requireSignature:true` giữ nguyên).
- Tầng 2 (`getServerSession`) = web RSC-only, mobile không chạm.
- Tầng 3 (`useMe`) ở shared, RN-safe (apiGet + qk).
- **Không đổi API signature / token format** → mobile zero-coordination.

---

## 5. Lộ trình + Verify
| Phase | Nội dung | Rủi ro | Đo |
|---|---|---|---|
| **P1** | Tầng 1 — `secondaryStorage` Redis | thấp | session đọc Redis/cookie >90%; TTFB `(app)` giảm |
| **P2** | Tầng 2 — `getServerSession` dedup + gỡ getSession layout | thấp | số session-resolve/1 request: 3-5 → 1 |
| **P3** | Tầng 3 — `useMe` + RQ setQueryData | thấp | bỏ fetch trùng client; XP tươi sau mutation |
| **P4** | Tầng 4 — PPR/segmentation | **cao — duyệt riêng** | first-load prod (LCP) trang gần-công-khai |

**Metrics chốt:** (1) session→Redis hit-rate >90%; (2) DB session query −80%; (3) TTFB `(app)`
warm −50…−200ms; (4) cold-start: vẫn còn nhưng hiếm (chỉ khi cả cookie+Redis miss).

**Lưu ý latency nền:** Tầng 1-3 trị phần "đập DB mỗi request". Phần "Neon ở Singapore" là vật lý
mạng — cache giảm SỐ LẦN, không xoá được RTT cho lần miss. Muốn mượt tuyệt đối khi DEV → vẫn nên
dùng Docker local; Neon cho prod. Tầng 4 (vỏ tĩnh CDN) mới cắt được first-load kể cả prod.

---

## 6. Thứ tự đề xuất
**P1 → P2 → P3 (gói "session rẻ + dedup + RQ", rủi ro thấp, làm liền được)**, đo kết quả,
rồi quyết **P4 (PPR)** riêng. P1 một mình đã giải ~80% cảm giác chậm (session-per-request → Redis).
