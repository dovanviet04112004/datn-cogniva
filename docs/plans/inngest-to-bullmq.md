# Migrate Background Jobs: Inngest → BullMQ (self-host VPS)

> Trạng thái: **✅ SHIPPED (2026-06-03)**. Hướng = **BullMQ** (Redis-backed), đã bỏ HẲN Inngest.
> Mục tiêu: thoát Inngest Cloud, tự sở hữu hàng đợi trên VPS, tái dùng Redis ioredis sẵn có,
> theo đúng pattern worker process đã dựng (`apps/realtime`). Chuẩn [[feedback_conform_arch_standards]].
>
> **Kết quả verify:** typecheck sạch + `next build` ✓ (109 trang) + worker boot thật OK
> (`worker.ready`, 11 cron đăng ký, tsx resolve `@/`, connect Redis+DB). Adversarial verify
> (port-fidelity qua git-compare · idempotency · wiring): port 13 job trung thực; wiring đúng
> (11 cron khớp CRON_MAP, maxRetriesPerRequest:null, lazy getter không connect lúc build).
> 2/3 "blocker" idempotency là false-positive (tutoring escrow đã trong `db.transaction` + cron
> `attempts:1`; double-push không xảy ra vì cron không retry). Đã vá 1 cái thật: **process-recording**
> (job duy nhất retry có insert không-idempotent) → gói `status=PROCESSED` + insert flashcard vào
> **1 transaction** + `persisted` guard ở catch → retry early-return, không double-insert. Đã dọn
> exempt `/api/inngest` thừa trong middleware.
>
> **Retry semantics (nhớ):** cron `attempts:1` (KHÔNG retry — lỡ thì lần schedule sau, dedupe qua
> notification_log/WHERE status); event jobs retry (recording 2, document 3) + đã idempotent.

---

## 0. TL;DR

- Thêm **1 worker process** trong `apps/web` (entry `src/worker/index.ts`, chạy `tsx` như các script
  hiện có) — chia sẻ TOÀN BỘ code (`@cogniva/db`, `@/lib/*`, AI, R2, redis) nên KHÔNG cross-app import.
- **2 event job** (`recording/finished`, `document/ingested`) → 2 BullMQ queue + Worker.
- **11 cron job** → BullMQ **repeatable jobs** (1 `cronQueue`, worker concurrency 1 = an toàn cho gdpr serial).
- **`step.run` → plain await** + dựa trên idempotency có sẵn; riêng `process-recording` thêm
  **checkpoint DB** để retry không chạy lại Whisper/summary (đắt).
- **Gỡ**: `inngest` dep, `src/inngest/*`, `/api/inngest` route, env `INNGEST_*`, script `dev:inngest`.
  **Không** cần secret mới (BullMQ chỉ cần `REDIS_URL`).
- **UI**: Bull Board (admin-only) — tuỳ chọn, mount trong worker.
- **Mobile-safe (bất biến)**: BullMQ/ioredis/db/worker = **server-only ở `apps/web/src`**, TUYỆT ĐỐI
  không vào `packages/shared` (giữ RN-safe = chỉ zod). Worker là **process thứ 2 của apps/web**, không
  app riêng → share code, không cross-app import. Xem §8.

---

## 1. Hiện trạng (đã map đầy đủ)

13 "Inngest function" = **2 loại tải khác hẳn**:

**Event-driven (2 — true queue):**
| Job | Trigger | Đặc điểm | Idempotent? |
|---|---|---|---|
| `process-recording` | event `recording/finished` (webhook LiveKit) | **10–30'**, concurrency 2, retries 3, 7 step (audio→Whisper→summary→chapter→flashcard→persist→notify). Có bản inline `lib/recording/inline-pipeline.ts` cho channel-recording | Một phần (status flow) — cần checkpoint |
| `extract-document-concepts` | event `document/ingested` | 5–30s, concurrency 2, retries 3 | ✅ ON CONFLICT DO NOTHING |

**Cron (11 — chỉ cần scheduler):** health-monitor `*/5`, reconcile-leaderboard `*/30`, flashcard-due-reminder daily, process-gdpr-deletion daily (concurrency **1**), tutoring-auto-complete hourly (revenue/escrow ⚠️), tutoring-recurring-rollout daily (revenue ⚠️), tutoring-refresh-embeddings daily, thread-archive-stale daily, library-saved-search-notify daily, library-pro-downgrade daily (revenue ⚠️), library-pro-expiry-warn daily.

**Senders (2):** `inngest.send('recording/finished')` ở `api/webhooks/livekit/route.ts:267`; `inngest.send('document/ingested')` ở `lib/ingest/pipeline.ts:107` (best-effort, no-await).

**Bối cảnh:** Redis = **ioredis TCP** (`REDIS_URL`) → BullMQ chạy được. Đã có worker process pattern
(`apps/realtime`). docker-compose.prod còn chỗ cho worker service. Deploy hiện = Inngest Cloud (prod)

- `inngest-cli dev` (dev). `tsx` đã resolve `@/` alias (các script `eval:*` đang dùng).

---

## 2. Inngest → BullMQ: ánh xạ khái niệm

| Inngest                      | BullMQ tương đương                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `createFunction({event})`    | `new Worker(queue, processor)` + `queue.add(name, data)`                                                                   |
| `createFunction({cron})`     | `queue.upsertJobScheduler(id, { pattern, tz })` (repeatable job)                                                           |
| `step.run('x', fn)`          | `await fn()` thuần. Cô lập retry/memoization → thay bằng **idempotency** (đa số có sẵn) hoặc **checkpoint DB** (recording) |
| `retries: N`                 | job opts `attempts: N+1, backoff: { type:'exponential', delay }`                                                           |
| `concurrency: { limit }`     | `new Worker(..., { concurrency })` hoặc queue limiter                                                                      |
| `inngest.send(name, data)`   | `queue.add(name, data, { jobId, attempts, backoff })` — `jobId` cho **dedup** (bonus so với Inngest)                       |
| Dev server UI                | Bull Board (`@bull-board`)                                                                                                 |
| Retry resume từ step đã xong | ❌ không có → whole-job retry; bù bằng idempotency/checkpoint                                                              |

**Bảng 13 job → queue + opts:**
| Job | Queue | Trigger BullMQ | concurrency | attempts |
|---|---|---|---|---|
| process-recording | `recording` | event (add từ webhook, `jobId=recordingId`) | 2 | 2 + checkpoint |
| extract-document-concepts | `document` | event (add từ pipeline, `jobId=documentId`) | 2 | 3 |
| 11 cron còn lại | `cron` | repeatable (`upsertJobScheduler`) | **1** (serial, an toàn gdpr) | 1–2 |

> Vì sao cron 1 queue concurrency 1: các cron đều ngắn (<30s) + chạy thưa (daily, trừ health `*/5`,
> reconcile `*/30`). Serial loại bỏ overlap + thoả ràng buộc gdpr concurrency=1. Nếu sau này health-monitor
> bị job dài chèn, tách `cronFast` riêng — ghi chú, chưa cần.

---

## 3. Kiến trúc đích

```
apps/web (Next.js)                         apps/web — WORKER process (tsx src/worker/index.ts)
 ├─ webhook/livekit ─ recordingQueue.add ─►│  Worker('recording', processRecording)   conc 2
 ├─ ingest/pipeline ─ documentQueue.add ──►│  Worker('document',  extractConcepts)    conc 3? (limit 2)
 │                                         │  Worker('cron', dispatchCron)            conc 1
 │   (Queue chỉ enqueue, share connection) │   └─ upsertJobScheduler × 11 (repeatable)
 └─ src/queue/{connection,queues,jobs}     │  Bull Board /admin (tuỳ chọn, localhost port)
                                           ▼
                              Redis (ioredis TCP, REDIS_URL) — đã có sẵn
```

**Connection (BullMQ yêu cầu `maxRetriesPerRequest: null`)** — KHÔNG tái dùng `IoRedisAdapter` của
cache (nó set =2). Tạo connection riêng:

```ts
// apps/web/src/queue/connection.ts
import IORedis from 'ioredis';
export function bullConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL bắt buộc cho BullMQ');
  return new IORedis(url, { maxRetriesPerRequest: null }); // BullMQ blocking BRPOPLPUSH
}
```

**Queues (phía enqueue — dùng cả ở web routes):**

```ts
// apps/web/src/queue/queues.ts
import { Queue } from 'bullmq';
const connection = bullConnection();
export const recordingQueue = new Queue('recording', { connection });
export const documentQueue = new Queue('document', { connection });
export const cronQueue = new Queue('cron', { connection });
```

**Job name + payload types (thay `InngestEvents`):**

```ts
// apps/web/src/queue/jobs.ts
export type RecordingJob = { recordingId: string; fileUrl: string; roomId?: string; channelId?: string; ... };
export type DocumentJob  = { documentId: string; userId: string; plan: 'FREE'|'PRO'|'TEAM'|'ENTERPRISE' };
export const CRON_JOBS = [
  { id: 'health-monitor',            pattern: '*/5 * * * *' },
  { id: 'reconcile-leaderboard',     pattern: '*/30 * * * *' },
  { id: 'flashcard-due-reminder',    pattern: '0 13 * * *' },
  { id: 'process-gdpr-deletion',     pattern: '0 3 * * *' },
  { id: 'tutoring-auto-complete',    pattern: '5 * * * *' },
  { id: 'tutoring-recurring-rollout',pattern: '30 2 * * *' },
  { id: 'tutoring-refresh-embeddings',pattern:'0 3 * * *' },
  { id: 'thread-archive-stale',      pattern: '0 2 * * *' },
  { id: 'library-saved-search-notify',pattern:'0 14 * * *' },
  { id: 'library-pro-downgrade',     pattern: '0 3 * * *' },
  { id: 'library-pro-expiry-warn',   pattern: '0 9 * * *' },
] as const; // GIỮ NGUYÊN giờ UTC như Inngest
```

**Job logic (di chuyển từ `inngest/functions/*` → `jobs/*`, bỏ wrapper):**

```ts
// apps/web/src/jobs/reconcile-leaderboard.ts  (ví dụ cron — unwrap step.run)
import { db, userStats } from '@cogniva/db';
import { lbBackfill } from '@/lib/cache/leaderboard';
export async function reconcileLeaderboard() {
  const all = await db.select({ userId: userStats.userId, xp: userStats.xp }).from(userStats);
  await lbBackfill(all);
  return { rebuilt: all.length };
}
```

**Worker entrypoint:**

```ts
// apps/web/src/worker/index.ts
import { Worker } from 'bullmq';
import { bullConnection } from '@/queue/connection';
import { cronQueue } from '@/queue/queues';
import { CRON_JOBS } from '@/queue/jobs';
import * as jobs from '@/jobs';

const connection = bullConnection();

// Event workers
new Worker('recording', async (job) => jobs.processRecording(job.data), {
  connection,
  concurrency: 2,
});
new Worker('document', async (job) => jobs.extractDocumentConcepts(job.data), {
  connection,
  concurrency: 2,
});

// Cron: 1 worker dispatch theo job.name → logic tương ứng
const CRON_MAP: Record<string, () => Promise<unknown>> = {
  'health-monitor': jobs.healthMonitor,
  'reconcile-leaderboard': jobs.reconcileLeaderboard,
  /* …11 cái… */
};
new Worker('cron', async (job) => CRON_MAP[job.name]?.(), { connection, concurrency: 1 });

// Đăng ký repeatable (idempotent upsert) lúc boot
for (const c of CRON_JOBS) {
  await cronQueue.upsertJobScheduler(c.id, { pattern: c.pattern, tz: 'UTC' }, { name: c.id });
}
console.log('[worker] BullMQ workers + crons ready');
// Graceful shutdown SIGINT/SIGTERM → worker.close() (như apps/realtime)
```

**Senders (web) — đổi `inngest.send` → `queue.add`:**

```ts
// webhook/livekit: recordingQueue.add('process', data, { jobId: data.recordingId, attempts: 2,
//   backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 100, removeOnFail: 500 });
// ingest/pipeline: documentQueue.add('extract', data, { jobId: data.documentId, attempts: 3,
//   backoff: { type: 'exponential', delay: 10_000 } });
```

---

## 4. Idempotency / whole-job retry (điểm cần soát kỹ)

BullMQ retry CẢ job → phải an toàn khi chạy lại:

- **extract-document-concepts**: ✅ đã idempotent (ON CONFLICT, UPDATE WHERE NULL). Port thẳng.
- **process-recording** ⚠️: Whisper/summary đắt + dài. Thêm **checkpoint**: đầu job đọc `recording` row;
  nếu đã có `transcript` → bỏ Whisper; đã có `summary` → bỏ summarize; persist sớm từng phần. `attempts:2`.
  Đã có sẵn `/sync` route + inline-pipeline làm đường retry tay → an toàn.
- **Notification crons** (flashcard/pro-expiry/saved-search): có **dedupe 24h/7d qua `notification_log`** →
  retry không gửi trùng. ✅ (giữ logic dedupe).
- **gdpr-deletion**: per-request status PENDING→PROCESSING→COMPLETED → retry skip COMPLETED. ✅ concurrency 1.
- **pro-downgrade / thread-archive / tutoring-auto-complete / recurring-rollout**: `WHERE status/plan` +
  transaction → idempotent. ✅
- **reconcile-leaderboard**: DEL+ZADD atomic (Lua) → chạy lại vô hại. ✅
- **health-monitor**: INCR counter → retry double-count nhẹ; đặt `attempts:1`. ✅

---

## 5. Checklist file

**Tạo:**

- `apps/web/src/queue/{connection,queues,jobs}.ts`
- `apps/web/src/worker/index.ts` + graceful shutdown
- `apps/web/src/jobs/*.ts` (13 file logic, di từ `inngest/functions/*`) + `jobs/index.ts` (barrel)
- (tuỳ chọn) Bull Board mount trong worker (admin-only)

**Sửa:**

- `apps/web/src/app/api/webhooks/livekit/route.ts` — `inngest.send` → `recordingQueue.add`
- `apps/web/src/lib/ingest/pipeline.ts` — `inngest.send` → `documentQueue.add`
- `apps/web/src/lib/env.ts` — bỏ `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` (REDIS_URL đã có)
- `apps/web/src/app/api/admin/system/jobs/route.ts` — trỏ Bull Board / queue counts thay Inngest Cloud
- `apps/web/package.json` — bỏ `inngest`; thêm `bullmq` (+ `@bull-board/api`,`@bull-board/express` nếu UI);
  thêm script `"worker": "tsx --env-file=.env.local src/worker/index.ts"`
- `package.json` (root) — bỏ `dev:inngest`; thêm `dev:worker`
- `.env.example` / `apps/web/.env.local` — bỏ `INNGEST_*`
- `infrastructure/docker-compose.prod.yml` — thêm service `worker` (build apps/web, command chạy worker,
  `REDIS_URL=redis://redis:6379`, `depends_on: redis`)
- `infrastructure/docker-compose.dev.yml` / README — note chạy worker qua pnpm

**Xoá:**

- `apps/web/src/inngest/` (client.ts + functions/\*) — sau khi di logic sang `jobs/`
- `apps/web/src/app/api/inngest/route.ts`
- `vercel.json`: không cần đổi (Inngest Cloud auto-sync sẽ ngừng khi gỡ route)

---

## 6. Dev & Deploy

**Dev:** redis qua docker compose dev → `pnpm --filter @cogniva/web worker` (tsx watch) cạnh `next dev`.
Bỏ `pnpm dev:inngest`.

**Prod (VPS):** thêm service `worker` vào docker-compose.prod (cùng image apps/web, khác command).
Hoặc chạy `node`/`tsx` worker bằng PM2/systemd cạnh `next start`. 1 replica (BullMQ lock chống chạy
trùng; muốn scale event-heavy thì tăng replica — repeatable cron KHÔNG nhân đôi nhờ scheduler key).

---

## 7. Verify

1. `pnpm --filter @cogniva/web typecheck` + `build`.
2. Dev: chạy worker + web. Test:
   - Upload PDF → `document/ingested` enqueue → worker extract concepts (log + DB pivot).
   - Trigger recording webhook (hoặc `/sync`) → `recording` job → transcript/summary/flashcard.
   - Repeatable: tạm set 1 cron `* * * * *` → thấy chạy mỗi phút (rồi revert).
   - Bull Board (nếu mount) liệt kê job completed/failed.
3. Idempotency: chạy lại 1 job đã completed (re-add cùng jobId) → không double-act.

---

## 8. Kỷ luật: tối ưu với hệ thống hiện tại + mobile-safe

Bắt buộc bám 2 trục này khi implement (theo [[feedback_conform_arch_standards]] +
[[feedback_web_mobile_shared_discipline]]):

**A. Tích hợp — TÁI DÙNG, không viết lại:**

- 1 **Redis instance** đang có (connection BullMQ riêng chỉ vì cần `maxRetriesPerRequest:null`; KHÔNG
  fork Redis mới). Đặt cạnh cache + Socket.IO adapter + secondaryStorage.
- Job logic **gọi lại lib hiện có**, không nhân bản: `lbBackfill`, `extractConceptsForChunks`,
  `inline-pipeline`/`media/*` (recording), `notify`/`notification_log` dedupe, **cache invalidate
  choke-point** (`onDashboardChanged`/`onRoomRecordingsChanged`…), `triggerEvent` (Socket.IO) để báo
  web/mobile cập nhật. Job xong vẫn đi đúng đường cache+realtime đã chuẩn-hoá — KHÔNG tự chế.
- `process-recording` tái dùng đường `/sync` + inline-pipeline làm retry tay (đã tồn tại) thay vì dựng cơ chế mới.
- Worker dùng đúng pattern `apps/realtime` (tsx, graceful SIGINT/SIGTERM, docker service riêng).

**B. Mobile-safe — RANH GIỚI cứng (để sau còn dev app mobile):**

- `bullmq`, `ioredis`, `@cogniva/db`, `src/queue/*`, `src/worker/*`, `src/jobs/*` = **SERVER-ONLY**,
  chỉ ở `apps/web`. **TUYỆT ĐỐI không import vào `packages/shared`** (shared phải RN-safe = chỉ zod) và
  **không vào `apps/mobile`**. Mobile KHÔNG enqueue job.
- Nếu sau cần share _job-name/payload type_ cho tooling chung → để **plain TS/zod** ở `packages/shared`,
  KHÔNG kéo theo bullmq/ioredis. Hiện mobile không cần → chưa tạo.
- **Job phục vụ mobile vẫn nguyên hành vi**: `flashcard-due-reminder`, `library-pro-expiry-warn`,
  `library-saved-search-notify` bắn **Expo Push** tới mobile → giữ y nguyên (chỉ đổi cơ chế schedule,
  không đổi push path). Mobile vẫn nhận noti như cũ.
- Mobile thao tác qua **API + push + realtime** (Socket.IO) — KHÔNG đụng tới hàng đợi. Queue layer
  server-only nên 0 ảnh hưởng RN Metro bundle.

## 9. Rollback / phased

- Mỗi phase 1 commit; có thể giữ Inngest song song trong lúc bắc cầu (worker + Inngest cùng chạy,
  cutover senders sau). **KHÔNG amend, commit/push khi user yêu cầu.**
- Bỏ Inngest ở bước cuối sau khi BullMQ verify xanh.

Liên quan: [[project_socketio_migration_shipped]] (cùng pattern worker process self-host) ·
[[feedback_conform_arch_standards]] · `docs/plans/redis-cache.md`.
