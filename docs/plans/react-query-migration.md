# React Query migration — lớp data toàn app (A→Z)

> Mục tiêu: thay toàn bộ pattern `useEffect + fetch + useState(loading/error)` rải rác
> bằng **TanStack React Query v5** làm lớp data thống nhất: cache + dedupe + revalidate
> (stale-while-revalidate), **persistence IndexedDB** cho instant cold-start, devtools.
> Hết "tải lại" khi đổi trang/đổi tab; mutation revalidate bằng `invalidateQueries`
> thay cho `router.refresh()` / refetch thủ công.
>
> Quyết định (2026-06-02): **React Query** (không SWR) + **IndexedDB** persistence.

## Bối cảnh — audit toàn hệ thống (14 vùng)

| Vùng | reads (GET mount) | mutations | realtime | Độ khó |
|---|---|---|---|---|
| groups+dm | 8 | 17 | ✅ | cao |
| workspaces | 11 | 26 | — | cao |
| library | 9 | 33 | — | cao |
| exams | 3 | 9 | — | cao |
| rooms | 3 | 10 | ✅ | cao |
| admin | 7 | 27 | — | TB |
| tutoring+wallet | 5 | 25 | — | TB |
| flashcards+quiz | 4 | 7 | — | TB |
| dashboard+analytics+leaderboard+studyplan | 5 | 3 | — | TB |
| chat+messages | 3 | 3 | ✅ | TB |
| shared+layout+providers | 3 | 6 | ✅ | TB |
| documents+notes | 3 | 3 | — | thấp |
| profile+settings+join | 3 | 6 | — | thấp |
| graph+atoms | 3 | 1 | — | thấp |
| **TỔNG** | **~70** | **~176** | 4 vùng | |

Pattern lặp lại cần helper chung: `Promise.all` (gộp 2-3 GET), cursor pagination
(`before=`), optimistic + rollback, debounced autocomplete (AbortController),
FormData upload, `cache:'no-store'`, version-bump refetch, `router.refresh()`.

## Kiến trúc nền tảng

### Packages
- `@tanstack/react-query` — core
- `@tanstack/react-query-devtools` — devtools (chỉ dev)
- `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` — persist
- `idb-keyval` — backing IndexedDB cho async persister

### Files nền — CẬP NHẬT (2026-06-02): data layer ở `packages/shared` (mobile-ready)

Quyết định: có `apps/mobile` (Expo RN) đang dev → **phần PORTABLE ở `packages/shared`**,
phần platform-specific ở từng app. Xem [[feedback-web-mobile-shared-discipline]].

**`packages/shared` (dùng chung web + mobile):**
- `src/api/config.ts` — `configureApi`/`getApiConfig` (baseUrl + auth token + credentials).
- `src/api/rq-fetcher.ts` — `apiGet`/`apiSend`/`apiUpload` (throw `ApiRequestError` khi !ok).
  RN-safe: không DOM-global (`credentials` là literal union, không `RequestCredentials`).
- `src/query/keys.ts` — `qk` factory tập trung (mở rộng dần theo wave).
- (sắp tới) `src/query/queries.ts` — query-option factory `xQuery()` + DTO ở `src/types/`.
- Lưu ý: `createApiClient` (Result-style) cũ vẫn còn cho mobile — định hướng hội tụ về factories.

**`apps/web` (platform-specific):**
- `src/components/providers/query-provider.tsx` — `QueryClient` + `PersistQueryClientProvider`
  (persister **IndexedDB**) + devtools + `configureApi({ baseUrl:'', credentials:'include' })`.
- `src/lib/query/idb-persister.ts` — adapter idb-keyval → AsyncStorage interface (web).
- `src/lib/query/use-realtime-query.ts` — cầu Socket.IO → cache (`useRealtimeSetData`/`useRealtimeInvalidate`).
- `@cogniva/shared` đã thêm vào web deps + `next.config.mjs` transpilePackages.

**`apps/mobile` (đã có sẵn):** QueryClient + `PersistQueryClientProvider` (AsyncStorage) ở
`app/_layout.tsx`; `configureApi(...)` ở `src/lib/api.ts` (baseUrl Expo env + Bearer + omit cookie).

### Config QueryClient (mặc định)
- `staleTime`: 60_000 (1 phút) — đủ để đổi tab/back không refetch ngay.
- `gcTime`: 24h — để persistence giữ được lâu.
- `refetchOnWindowFocus`: true (revalidate khi quay lại tab).
- `retry`: 1 (GET); mutation không retry.
- Persist: `maxAge` 24h, `buster` = app version, chỉ dehydrate query `status==='success'`.

### Convention
- Đọc: `useQuery({ queryKey: qk.x(...), queryFn: () => apiGet('/api/...') })`.
- Ghi: `useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey }) })`
  hoặc optimistic qua `onMutate`/`onError` rollback/`onSettled`.
- Pagination: `useInfiniteQuery` (getNextPageParam = oldest id).
- Realtime: event → `qc.setQueryData(key, updater)` (không refetch) hoặc invalidate.

## Thứ tự thực hiện (waves)

- **Nền tảng** — provider + persistence + helper + keys gốc.
- **Wave 0 (proof)** — 1 read low-risk (flashcards stats hoặc notes list) để chốt pattern + typecheck.
- **Wave 1 (groups, ưu tiên + dọn cache)** — text-channel/dm-chat/forum-channel sang
  React Query (useInfiniteQuery + realtime setQueryData) **và XOÁ `src/lib/message-cache.ts`**
  (ad-hoc cache duy nhất). Đây là phần đau nhất của user + có realtime để validate cầu nối.
- **Wave 2 (thấp)** — documents+notes, profile+settings+join, graph+atoms.
- **Wave 3 (TB)** — flashcards+quiz, tutoring+wallet, chat+messages, dashboard/analytics,
  shared/layout, admin.
- **Wave 4 (cao)** — workspaces, library, exams, rooms.

Mỗi wave: migrate reads trước (hết reload) → mutations dùng `invalidateQueries` (bỏ
`router.refresh()` thủ công) → typecheck → next.

## Dọn dẹp (cache lẻ tẻ — theo yêu cầu user)
- `src/lib/message-cache.ts` + usage ở text-channel/dm-chat/forum-channel → **XOÁ ở Wave 1**
  (thay bằng React Query cache). Không xoá sớm hơn để tránh regression "tải lại tin nhắn".
- GIỮ: localStorage UI-pref/draft (sidebar collapse, theme, pomodoro, voice prefs, dock chat,
  compare cart, exam draft answers, consent...) — KHÔNG phải cache dữ liệu API.
- GIỮ: `graph-view.tsx` sessionStorage cache **layout Dagre** (cache tính toán, không phải API).
- KHÔNG đụng: cache phía server (`lib/ai/*cache*`, `lib/system/config.ts`, `lib/redis.ts`).

## Lưu ý
- `staleTimes` trong `next.config.mjs` (đã set 60s/180s) vẫn giữ — cache vỏ RSC, bổ trợ
  cho React Query (cache nội dung). 2 lớp khác nhau, không xung đột.
- SSR: query chạy client-side, không nằm trong HTML đầu → không hydration mismatch.
  Persistence hydrate async sau mount.
- Realtime areas phải chuyển `setState` cục bộ → `setQueryData` để cache là source-of-truth.
