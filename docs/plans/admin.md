# 🛡️ Cogniva Admin Console — Master Plan

> **Mục tiêu**: Trang quản trị **tách biệt hoàn toàn** với trang sản phẩm, dành cho owner / admin team giám sát + vận hành hệ thống. Không dùng layout của `(app)/` (AppSidebar / AppTopbar) — admin có shell, navigation, theme riêng.

---

## 📑 Mục lục

1. [Tổng quan & Nguyên tắc thiết kế](#1-tổng-quan--nguyên-tắc-thiết-kế)
2. [Phân quyền & Auth flow](#2-phân-quyền--auth-flow)
3. [Kiến trúc routing](#3-kiến-trúc-routing)
4. [Layout & Navigation](#4-layout--navigation)
5. [Feature modules](#5-feature-modules)
6. [Database & API](#6-database--api)
7. [Bảo mật & Audit](#7-bảo-mật--audit)
8. [Quan sát hệ thống (Observability)](#8-quan-sát-hệ-thống-observability)
9. [Roadmap implementation](#9-roadmap-implementation)
10. [UI/UX style guide](#10-uiux-style-guide)

---

## 1. Tổng quan & Nguyên tắc thiết kế

### 1.1. Triết lý

- **Power over polish**: ưu tiên dày dữ liệu + filter + bulk action thay vì motion/decoration.
- **Read-first, write-confirmed**: mọi destructive action (suspend, delete, refund) bắt buộc 2-step confirm + reason text.
- **Audit everything**: mọi mutation admin sinh `admin_audit_log` row — ai, làm gì, khi nào, payload before/after.
- **Zero leak between admin & product**: không share session / cookie / sidebar / theme với app user. Mở admin trong tab mới thay vì điều hướng từ app.

### 1.2. Differentiators so với "Django admin" mặc định

| | Generic admin | Cogniva admin |
|---|---|---|
| Auth | Reuse user session | Tách session, MFA bắt buộc, IP allowlist option |
| Layout | Same sidebar | Riêng shell, dark-mode default |
| Search | Per-table | Global command-K (user, doc, conversation, …) |
| Charts | Static | Live metrics (PostHog + Sentry embed + chart riêng) |
| Mutation | Direct DB | Qua API endpoint dedicated, audited |
| Impersonation | Direct login | Read-only mode + banner overlay, kill-switch |

### 1.3. Out of scope (không làm phase 1)

- Multi-tenant org switching
- Custom dashboard builder kiểu Retool
- Marketing campaign manager
- Multi-language admin UI

---

## 2. Phân quyền & Auth flow

### 2.1. Roles

```
SUPER_ADMIN  — owner. Toàn quyền: user delete, plan change, refund, kill switch.
ADMIN        — KYC reviewer, content moderator. Không refund, không delete user.
SUPPORT      — view-only access, có thể tạo ticket nội bộ.
```

Persist trong cột mới `user.admin_role` (enum), default `NULL` (user thường).

### 2.2. Auth flow

```
1. Browser hit /admin/* → middleware check:
     - session valid?
     - user.admin_role IS NOT NULL?
     - IP trong NEXT_PUBLIC_ADMIN_IP_ALLOWLIST (optional, env-gated)?
2. Nếu fail → redirect /admin/sign-in với redirect param.
3. /admin/sign-in: email + password + 2FA TOTP (Phase 2+).
4. Sau auth thành công → SET-COOKIE riêng `cogniva_admin_session` (HttpOnly,
   Secure, SameSite=Strict, MaxAge=30m) — KHÔNG share với product cookie
   `cogniva_session`.
5. Idle timeout 30 phút auto sign-out (track qua lastActivityAt).
```

### 2.3. Middleware

File mới `apps/web/src/middleware/admin.ts` (gộp vào main middleware matcher):

```ts
export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
```

Chặn sớm trước khi vào layout — tránh leak shell skeleton.

### 2.4. Multi-factor (Phase 2)

- TOTP qua Better Auth `passkey` hoặc plugin `two-factor`.
- Mỗi action destructive yêu cầu re-prompt OTP (sudo mode, 5 phút).

---

## 3. Kiến trúc routing

### 3.1. Structure

```
apps/web/src/app/
  (app)/                       ← user product, KHÔNG đụng
    layout.tsx
    dashboard/
    workspaces/
    ...
  admin/                       ← KHÔNG nằm trong (app) group
    layout.tsx                 ← AdminShell (sidebar + topbar riêng)
    page.tsx                   ← dashboard tổng quan
    sign-in/
      page.tsx                 ← form login riêng
    users/
      page.tsx                 ← list users
      [id]/
        page.tsx               ← user detail
    documents/
      page.tsx
      [id]/page.tsx
    conversations/
      page.tsx
      [id]/page.tsx
    groups/
      page.tsx
      [id]/page.tsx
    tutoring/
      kyc/                     ← migrate từ (app)/admin/kyc về đây
        page.tsx
        [id]/page.tsx
      bookings/
        page.tsx
      reviews/
        page.tsx
    ai/
      cost/page.tsx            ← per-provider cost dashboard
      usage/page.tsx           ← rate limit hits, token spend per user
      circuits/page.tsx        ← circuit breaker status
    moderation/
      reports/page.tsx         ← reported content queue
      banned/page.tsx
    system/
      jobs/page.tsx            ← BullMQ queue counts
      flags/page.tsx           ← feature flags
      maintenance/page.tsx     ← kill switch + banner toggle
    audit/
      page.tsx                 ← admin action log

  api/admin/                   ← dedicated admin API
    users/route.ts
    users/[id]/route.ts
    users/[id]/plan/route.ts
    users/[id]/suspend/route.ts
    docs/...
    ai/cost/route.ts
    ...
```

### 3.2. Layout tách biệt

`apps/web/src/app/admin/layout.tsx`:

```tsx
import { AdminShell } from '@/components/admin/admin-shell';
import { requireAdmin } from '@/lib/admin/guard';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <AdminShell>{children}</AdminShell>;
}
```

- `requireAdmin()` throw redirect nếu không pass middleware (defense-in-depth).
- `AdminShell` chứa AdminSidebar + AdminTopbar + content area. **KHÔNG** import gì từ `(app)/` (AppSidebar, etc.).

### 3.3. Liên kết với product

- App user side **không có link nào** tới /admin trong sidebar.
- Truy cập admin qua URL trực tiếp (`/admin`) hoặc bookmark.
- Bỏ entry `Duyệt KYC` khỏi sidebar `Tutoring` group ở [sidebar.tsx](../../apps/web/src/components/app/sidebar.tsx) sau khi migrate.

---

## 4. Layout & Navigation

### 4.1. Shell

```
┌──────────────────────────────────────────────────────────┐
│ AdminTopbar: logo "Cogniva Admin" + search ⌘K + admin    │
│              avatar + sign-out + maintenance toggle      │
├──────┬───────────────────────────────────────────────────┤
│ Side │                                                   │
│ bar  │                Content area                       │
│ 240  │                                                   │
│ px   │                                                   │
│      │                                                   │
└──────┴───────────────────────────────────────────────────┘
```

- Topbar h-12, border-b, glass effect.
- Sidebar w-60 fixed, KHÔNG hover-expand (admin cần label luôn rõ).
- Dark mode default — visual cue rằng đây là môi trường khác.

### 4.2. Sidebar groups

```
OVERVIEW
  ├─ Dashboard            (/admin)
  └─ Audit log            (/admin/audit)

USERS & ACCESS
  ├─ Users                (/admin/users)
  ├─ Banned               (/admin/moderation/banned)
  └─ Reports              (/admin/moderation/reports)

CONTENT
  ├─ Documents            (/admin/documents)
  ├─ Conversations        (/admin/conversations)
  └─ Study groups         (/admin/groups)

TUTORING
  ├─ KYC queue            (/admin/tutoring/kyc)
  ├─ Bookings             (/admin/tutoring/bookings)
  └─ Reviews              (/admin/tutoring/reviews)

AI & COSTS
  ├─ Cost dashboard       (/admin/ai/cost)
  ├─ Usage by user        (/admin/ai/usage)
  └─ Circuit breakers     (/admin/ai/circuits)

SYSTEM
  ├─ Background jobs      (/admin/system/jobs)
  ├─ Feature flags        (/admin/system/flags)
  └─ Maintenance          (/admin/system/maintenance)
```

### 4.3. Global search (⌘K)

Endpoint `GET /api/admin/search?q=...` — fuzzy across:

- User: name, email, id
- Document: filename, id
- Conversation: title, id
- Study group: name
- Tutoring booking: id

Click result → navigate detail page.

### 4.4. Action confirm pattern

Mọi nút destructive (Suspend, Delete, Refund, Force sign-out) → modal:

```
┌─────────────────────────────────────┐
│ ⚠ Suspend user "DO VAN VIET"?       │
│                                     │
│ User sẽ không sign-in được. Toàn    │
│ bộ data giữ nguyên — có thể restore │
│ trong 30 ngày.                      │
│                                     │
│ Reason (bắt buộc, ghi audit log):   │
│ [_______________________________]   │
│                                     │
│        [Huỷ]    [Suspend]           │
└─────────────────────────────────────┘
```

- Reason min 10 chars, max 500.
- Confirm button disabled tới khi reason đủ length.

---

## 5. Feature modules

### 5.1. Dashboard `/admin`

**Hero metrics row** (4 tile):
- DAU (Daily Active Users) — track qua PostHog session events
- Total signups (all time, with delta % vs 7 ngày trước)
- AI cost hôm nay (USD, all providers)
- Sentry error rate 24h (errors / 1k requests)

**Charts** (3 cột × 2 hàng):
1. Signup trend 30 ngày (line chart, daily count)
2. AI cost trend 30 ngày (stacked area per provider)
3. Active conversations 24h (heatmap by hour)
4. Top 10 documents (count of citations) — table
5. Top 10 spenders (users by AI cost) — table
6. Recent admin actions (5 latest từ audit log)

**Quick actions** strip:
- Resolve next KYC item (link `/admin/tutoring/kyc`)
- View latest error in Sentry (deeplink)
- Toggle maintenance mode

### 5.2. Users `/admin/users`

**List view**:
- Table columns: avatar, name, email, plan, signup date, last active, status badge
- Search: name/email substring
- Filter: plan (FREE/PRO/TEAM), status (active/suspended), createdAt range
- Sort: any column
- Pagination: cursor-based, 50/page

**Detail `/admin/users/[id]`**:
- Header: avatar lớn + name + email + plan pill + status pill + admin role pill (nếu có)
- Tabs:
  - **Overview**: stats card (docs, conversations, flashcards, XP, streak) + last 7 ngày activity sparkline + signup → last active timeline
  - **Workspaces**: list workspaces + doc counts
  - **Documents**: list 50 docs gần nhất + status
  - **Conversations**: list 50 conversations + message counts
  - **AI usage**: token spend per provider, cost monthly trend
  - **Groups**: groups user joined / created
  - **Tutoring**: nếu tutor → KYC status, bookings, reviews rating
  - **Audit**: actions admin đã thực hiện trên user này
- Action menu (top right):
  - Change plan (dropdown FREE/PRO/TEAM)
  - Reset password (gửi email reset link)
  - Force sign-out all sessions
  - Toggle 2FA bắt buộc
  - Suspend / Unsuspend
  - **Impersonate** (read-only mode, 15 phút, banner đỏ)
  - **Delete** (GDPR Article 17 — soft delete + queue hard delete 30 ngày sau)

### 5.3. Documents `/admin/documents`

**List**:
- Columns: filename, owner email, workspace, size, status, chunks count, createdAt
- Filter: status (READY/PROCESSING/FAILED), owner email, mime type
- Bulk action: re-ingest selected (cho doc FAILED)

**Detail** `/admin/documents/[id]`:
- Metadata + workspace + owner
- Chunks list (paginated, preview text)
- Embedding stats (provider, dimensions, indexed at)
- Citation count (how many AI responses referenced this doc)
- Actions: re-ingest, force re-embed, soft delete, hard delete

### 5.4. Conversations `/admin/conversations`

- List 100 conversations gần nhất across users
- Search by title + content (full-text qua tsvector)
- Click → detail xem full message thread (read-only)
- Action: soft delete (cho support case nhạy cảm)

### 5.5. Study Groups `/admin/groups`

- List groups + member count + creator + createdAt
- Detail: members list, channels list, voice recordings, message count
- Action: suspend group, delete (kèm reason → notify all members)
- Voice recordings tab: list recordings, force delete

### 5.6. Tutoring modules

#### 5.6.1. KYC queue `/admin/tutoring/kyc`

**Đã có ở `/admin/kyc`** — migrate sang đây, không build lại.

- Queue: PENDING items ordered by submitted ASC
- Detail: full KYC form + uploaded ID images
- Action: APPROVE / REJECT (với reason)
- Audit: tự log

#### 5.6.2. Bookings `/admin/tutoring/bookings`

- List bookings: tutor, student, slot time, status, amount
- Filter: status (PENDING/CONFIRMED/COMPLETED/REFUND_REQUESTED)
- Detail: full booking + chat thread + payment status
- Action: Force cancel (notify both), Refund full/partial

#### 5.6.3. Reviews `/admin/tutoring/reviews`

- List reviews flagged by other users
- Detail: review text + rating + flag reason
- Action: Hide review, Ban reviewer (1 lần warning, 2 lần ban)

### 5.7. AI & Costs

#### 5.7.1. Cost dashboard `/admin/ai/cost`

- Line chart 90 ngày: cost per day per provider (OpenAI, Anthropic, Voyage, Cohere)
- Pie chart hôm nay: cost share per provider
- Table: top 20 users by cost (link to user detail)
- Table: cost per use-case (ragChat, quizGen, flashcardGen, embed, …)
- Alert config: budget alert email khi cost > threshold $/ngày

#### 5.7.2. Usage by user `/admin/ai/usage`

- Table: user, tokens in, tokens out, requests count, cost USD, rate limit hits
- Filter: date range, provider, use-case
- Export CSV (cho phân tích offline)

#### 5.7.3. Circuit breakers `/admin/ai/circuits`

- Card per provider: state (CLOSED/OPEN/HALF_OPEN), failures count, last error, opened at, retry at
- Manual reset button (force CLOSED) cho ops khi provider phục hồi
- Audit: tự log mọi state change

### 5.8. Moderation

#### 5.8.1. Reports queue `/admin/moderation/reports`

- List reports: reporter, target type (message/user/document), reason, createdAt
- Detail: report content + context (5 messages xung quanh nếu là chat)
- Action: Dismiss / Take down + Ban target / Warning

#### 5.8.2. Banned `/admin/moderation/banned`

- List banned users / suspended groups
- Filter: by date, by reason
- Action: Unban (restore status)

### 5.9. System

#### 5.9.1. Background jobs `/admin/system/jobs`

- BullMQ queue counts (queue `recording` / `document` / `cron`) qua /api/admin/system/jobs
- Filter by job name, status
- Action: Retry failed, Cancel running

#### 5.9.2. Feature flags `/admin/system/flags`

- Table: flag key, value, default, enabled-for-users (allowlist), enabled %
- Edit inline (Phase 2: GrowthBook integration)

#### 5.9.3. Maintenance `/admin/system/maintenance`

- Toggle "Maintenance mode": all routes redirect `/maintenance` (read-only landing). API trả 503.
- Toggle "Banner": global yellow banner above topbar (vd "Bảo trì 2 AM, sẽ down 5 phút").
- Edit banner text + emoji + dismissible flag.

### 5.10. Audit log `/admin/audit`

- Table: timestamp, admin user, action, target, payload diff, IP, user agent
- Filter: admin user, action type, target type, date range
- Click row → expanded view with full before/after JSON
- Export CSV

---

## 6. Database & API

### 6.1. Schema bổ sung

```sql
-- Phân quyền admin
ALTER TABLE "user" ADD COLUMN admin_role TEXT
  CHECK (admin_role IN ('SUPER_ADMIN','ADMIN','SUPPORT'))
  DEFAULT NULL;

-- Trạng thái suspend
ALTER TABLE "user" ADD COLUMN suspended_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE "user" ADD COLUMN suspend_reason TEXT DEFAULT NULL;

-- Audit log
CREATE TABLE admin_audit_log (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT NOT NULL REFERENCES "user"(id),
  action      TEXT NOT NULL,            -- 'user.suspend' | 'doc.delete' | …
  target_type TEXT NOT NULL,            -- 'user' | 'document' | …
  target_id   TEXT NOT NULL,
  payload     JSONB NOT NULL,           -- {before, after, reason, …}
  ip          INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_admin ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX idx_audit_target ON admin_audit_log(target_type, target_id);

-- Báo cáo content
CREATE TABLE content_report (
  id            TEXT PRIMARY KEY,
  reporter_id   TEXT NOT NULL REFERENCES "user"(id),
  target_type   TEXT NOT NULL,          -- 'message' | 'user' | 'review' | 'document'
  target_id     TEXT NOT NULL,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING',  -- 'PENDING'|'RESOLVED'|'DISMISSED'
  resolved_by   TEXT REFERENCES "user"(id),
  resolved_at   TIMESTAMPTZ,
  resolution    TEXT,                   -- 'dismiss'|'takedown'|'warn'|'ban'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_report_pending ON content_report(status, created_at) WHERE status='PENDING';

-- Maintenance flag (singleton)
CREATE TABLE system_config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT REFERENCES "user"(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- key 'maintenance' value { enabled: bool, banner: string|null, dismissible: bool }
```

### 6.2. API endpoints

Pattern: `/api/admin/<resource>/[<id>?]/<action?>`. Tất cả qua `requireAdminRole(...)` guard server-side, KHÔNG dùng client-side check.

```
GET    /api/admin/dashboard              → metrics tổng quan
GET    /api/admin/search?q=              → global ⌘K

GET    /api/admin/users                  → list (?filter, ?sort, ?cursor)
GET    /api/admin/users/[id]             → detail
PATCH  /api/admin/users/[id]             → update name/plan
POST   /api/admin/users/[id]/suspend     → { reason }
POST   /api/admin/users/[id]/unsuspend   → { reason }
POST   /api/admin/users/[id]/impersonate → returns short-lived read-only JWT
DELETE /api/admin/users/[id]             → soft delete + queue hard delete

GET    /api/admin/documents              → list
DELETE /api/admin/documents/[id]
POST   /api/admin/documents/[id]/reingest

GET    /api/admin/conversations          → list
DELETE /api/admin/conversations/[id]

GET    /api/admin/groups
POST   /api/admin/groups/[id]/suspend
DELETE /api/admin/groups/[id]

GET    /api/admin/tutoring/kyc            → existing (migrate)
POST   /api/admin/tutoring/kyc/[id]/approve
POST   /api/admin/tutoring/kyc/[id]/reject
GET    /api/admin/tutoring/bookings
POST   /api/admin/tutoring/bookings/[id]/refund
GET    /api/admin/tutoring/reviews
POST   /api/admin/tutoring/reviews/[id]/hide

GET    /api/admin/ai/cost                 → series + per-provider
GET    /api/admin/ai/usage                → per user
GET    /api/admin/ai/circuits             → state per provider
POST   /api/admin/ai/circuits/[provider]/reset

GET    /api/admin/moderation/reports      → queue
POST   /api/admin/moderation/reports/[id]/resolve

GET    /api/admin/system/jobs             → BullMQ queue counts
GET    /api/admin/system/flags
PATCH  /api/admin/system/flags/[key]
GET    /api/admin/system/maintenance
PATCH  /api/admin/system/maintenance

GET    /api/admin/audit                   → list + filter
```

### 6.3. Audit wrapper

Helper `withAudit(action, target, fn)`:

```ts
export async function withAudit<T>(
  ctx: { adminId: string; ip: string | null; userAgent: string | null },
  action: string,
  target: { type: string; id: string },
  fn: () => Promise<{ before?: unknown; after?: unknown; reason?: string; result: T }>,
): Promise<T> {
  const { before, after, reason, result } = await fn();
  await db.insert(adminAuditLog).values({
    id: createId(),
    adminId: ctx.adminId,
    action,
    targetType: target.type,
    targetId: target.id,
    payload: { before, after, reason },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return result;
}
```

Mọi mutation handler wrap qua `withAudit` để log nhất quán, không sót.

---

## 7. Bảo mật & Audit

### 7.1. Defense in depth

| Layer | Cơ chế |
|---|---|
| Network | Vercel WAF (rate limit per IP, geo restriction option) |
| Middleware | Check session + admin_role IS NOT NULL |
| Layout server | `requireAdmin()` throw redirect — chặn render shell |
| API handler | `requireAdminRole(['SUPER_ADMIN','ADMIN'])` guard |
| DB | RLS policy: admin_role check trên `admin_*` tables |
| Audit | Mọi mutation → row vào `admin_audit_log` |

### 7.2. Session

- Cookie name khác: `cogniva_admin_session` (vs `cogniva_session` của product).
- HttpOnly, Secure, SameSite=Strict, Path=/admin, MaxAge=30m (sliding).
- Refresh on every request — idle 30m auto sign-out.

### 7.3. Impersonation

- POST `/api/admin/users/[id]/impersonate` → tạo JWT ngắn hạn (15m), claims `{ userId, viaAdmin: <adminId>, readOnly: true }`.
- Browser mở tab mới `/?impersonate=<jwt>` — middleware nhận, set cookie tạm + redirect /dashboard.
- Banner đỏ sticky top: "🎭 Đang xem với tư cách <user> · [Thoát ngay]".
- Read-only: tất cả POST/PATCH/DELETE return 403 nếu claims có `readOnly`.
- Audit log mọi action impersonator thực hiện.

### 7.4. Rate limit admin endpoint

- 60 req/phút/admin (lỏng hơn user app vì admin cần tải nhiều dữ liệu).
- Burst 10/giây cho list view (paginate fast scroll).
- Action mutation: 1/giây/admin để chặn spam click.

---

## 8. Quan sát hệ thống (Observability)

### 8.1. Built-in (in-app)

- Dashboard metrics tổng hợp từ DB + PostHog client.
- Audit log filterable.

### 8.2. External embed (iframe / link out)

| Tool | Mục đích | Trang admin |
|---|---|---|
| Sentry | Error tracking | /admin/system/errors (deeplink list) |
| PostHog | Product analytics | /admin/dashboard embed graph |
| Langfuse | LLM traces | /admin/ai/traces (deeplink) |
| Vercel Logs | Edge function logs | /admin/system/logs (deeplink) |
| BullMQ | Job runs | /admin/system/jobs (queue counts API) |

Mỗi external link mở tab mới (`target="_blank" rel="noopener"`).

### 8.3. Alert routing

Daily 8AM cron:
- Top 5 users theo AI cost — Slack #admin-cogniva
- Failed BullMQ jobs 24h — email super_admin
- Error rate > 1% → Sentry already handles, mirror notify Slack

---

## 9. Roadmap implementation

### Phase 0 — Foundation (1 ngày)

- DB migration: `admin_role`, `admin_audit_log`, `content_report`, `system_config`
- `apps/web/src/middleware/admin.ts` — guard /admin/* + /api/admin/*
- `apps/web/src/lib/admin/guard.ts` — server `requireAdmin()`, `requireAdminRole()`
- `apps/web/src/app/admin/layout.tsx` — AdminShell skeleton
- `apps/web/src/components/admin/admin-shell.tsx` — sidebar + topbar riêng

### Phase 1 — Users module (2 ngày)

- List + detail page
- Suspend / unsuspend / change plan / force sign-out
- Audit wrapper
- `/api/admin/users/*` endpoints
- Migrate `/admin/kyc` → `/admin/tutoring/kyc`

### Phase 2 — Content + Moderation (2 ngày) ✅ SHIPPED 2026-05-20

- Documents, Conversations, Groups admin
- Content reports queue
- Take-down flow

**Đã ship**:
- `/admin/documents` list + detail (chunks preview, stats, re-ingest, delete)
- `/admin/conversations` list + thread viewer (read-only, citations, soft-delete)
- `/admin/groups` list + detail (members table, suspend/unsuspend) — migration 0026 thêm `study_group.suspended_at` + `suspend_reason`
- `/admin/moderation/reports` queue: 4 resolution (dismiss/takedown/warn/ban) + side-effects (delete content / suspend target)
- `/admin/moderation/banned` 2-tab (users + groups) với inline unsuspend
- 9 API endpoints under `/api/admin/{documents,conversations,groups,moderation}/*` — đều qua `withAudit()`

**Phase 2.1 follow-up — SHIPPED cùng ngày 2026-05-20**:
- ✅ Enforcement gate: POST `/api/channels/[id]/messages` check `studyGroup.suspendedAt` → trả 423 Locked khi suspended
- ✅ Hard delete group: SUPER_ADMIN only, FK CASCADE channels/messages/members/recordings, kèm notify members
- ✅ In-app notification (notification_log) khi admin suspend/unsuspend/delete group — `notifyGroupSuspend()` helper ở `lib/admin/notify.ts`
- ✅ Voice recordings tab trong group detail — list + download + force delete (R2 file cleanup nightly job)
- ✅ Report context window: 5 messages quanh target (ai_message hoặc group_message) ở expand panel
- ✅ Warn resolution → `notifyWarnUser()` insert notification_log với type='admin-warn'

**Deferred xa hơn (Phase 2.2+ khi cần)**:
- Email integration (Resend) — hiện notification chỉ in-app
- "Report" button trong product UI — chưa có route POST `/api/reports` để user submit
- Hard delete file recording trên R2 trực tiếp (hiện chỉ xoá DB row, R2 cleanup nightly)

### Phase 3 — AI & Costs (1.5 ngày) ✅ SHIPPED 2026-05-20

- Cost dashboard + provider breakdown
- Usage per user + export CSV
- Circuit breaker UI

**Đã ship**:
- Migration 0028 `ai_usage_log` (userId/plan/provider/model/feature/tokens/cost/latency/cached) + 4 indexes
- Wire `recordCost()` ở `lib/observability/cost-guardrail.ts` → fire-and-forget insert ai_usage_log (không block Redis counter path). Cập nhật call site ở `lib/ai/router.ts` truyền provider + tokensIn/Out.
- `/admin/ai/cost` — 4 KPI tiles + inline SVG line chart by day/provider + provider bar + feature table + top 20 users (7/30/90 day window selector)
- `/admin/ai/usage` — table per-user với date range + provider/feature/email filter + Export CSV (download text/csv)
- `/admin/ai/circuits` — auto-refresh 10s, card per circuit (state/fail/TTL), Reset CLOSED action (SUPER_ADMIN/ADMIN, audit logged)
- Helper `listCircuits()` SCAN Redis cb:* keys (Upstash + ioredis abstraction)
- 4 API endpoints under `/api/admin/ai/*` đều qua `requireAdminRole`

### Phase 4 — Tutoring marketplace admin (1.5 ngày) ✅ SHIPPED 2026-05-20

- Bookings refund flow
- Reviews moderation

**Đã ship**:
- Migration 0029 thêm `tutor_review.hidden_at` + `hidden_reason` + `hidden_by` + partial index
- `/admin/tutoring/bookings` — list cross-marketplace với filter status + email search, table dense (slot/subject/tutor/student/rate/status/payment)
- `/admin/tutoring/bookings/[id]` — detail với parties (tutor + student card), payment dl-grid, review preview, action menu: Force cancel (ADMIN+) + Refund partial/full (SUPER_ADMIN only)
- `/admin/tutoring/reviews` — list với 3-tab visibility (visible/hidden/all) + rating filter + comment/email search + inline Hide/Restore button
- Hành động notify reviewer khi review bị ẩn (notification_log type='admin-review-hide')
- Hành động notify cả 2 bên khi force cancel (notification_log type='admin-booking-cancel'), notify student khi refund (type='admin-booking-refund')
- Wire `hidden_at IS NULL` filter vào product:
  - `(app)/tutors/[id]/page.tsx` — review list trên tutor profile
  - `lib/tutoring/booking-helpers.ts` refreshTutorStats — rating_avg/count chỉ tính review chưa ẩn
- 5 API endpoints under `/api/admin/tutoring/*` đều qua `withAudit()`

### Phase 5 — System (1 ngày) ✅ SHIPPED 2026-05-20

- Background jobs view (BullMQ queue counts)
- Feature flags inline edit
- Maintenance mode toggle + banner

**Đã ship**:
- `lib/system/config.ts` — `getSystemConfig<T>`, `setSystemConfig`, `getFlag`, `listAllFlags`, `getMaintenanceConfig`. Cache 5s in-memory per-process.
- `/admin/system/maintenance` — toggle + banner editor (max 500 chars) + dismissible checkbox + preview. Submit yêu cầu reason ≥10 (audit log). SUPER_ADMIN only.
- `MaintenanceBanner` server component ở `(app)/layout.tsx` — amber banner top app khi enabled. Client component dismiss state lưu sessionStorage với hash banner text (banner mới → dismiss reset).
- `/admin/system/flags` — list + inline JSON editor + new flag modal + delete. Tên kebab-case validated. SUPER_ADMIN only.
- `/admin/system/jobs` — hiển thị queue counts BullMQ (waiting/active/completed/failed cho queue `recording`/`document`/`cron`) qua /api/admin/system/jobs.
- 3 API endpoints under `/api/admin/system/*` đều qua `withAudit()`

### Phase 6 — Polish (1 ngày) ✅ SHIPPED 2026-05-20

- Global ⌘K search
- Audit log filter UI
- Impersonation flow + read-only enforcement
- 2FA TOTP (Phase 2 follow-up)

**Đã ship**:
- `/admin/audit` — full filter UI (date range / admin email / action / target type+id) + JSON before/after diff viewer + IP/UA. Distinct values cho datalist autocomplete.
- ⌘K global search ở admin topbar — query 5 entity (user/document/conversation/group/booking) song song. Cmd+K / Ctrl+K toggle hydration-safe. Popover dropdown grouped by type.
- Impersonation V1 marker cookie (signed HMAC, no session swap): POST/DELETE `/api/admin/impersonate` + banner đỏ countdown TTL ở `(app)/layout.tsx`. Middleware chặn POST/PUT/PATCH/DELETE khi cookie hiện diện (Edge-safe — chỉ check presence). Audit log full với sessionId correlate.
- 2FA TOTP via better-auth twoFactor plugin: migration 0030 (`user.two_factor_enabled` + `two_factor` table). `/admin/security` enroll page với QR (api.qrserver.com) + backup codes + verify 6-digit. `/admin/sign-in/two-factor` challenge page với TOTP/backup toggle. Auto-redirect qua `onTwoFactorRedirect` ở auth-client.

**Phase 6.1+ deferred**:
- Impersonation full session swap (V1 chỉ marker) — cần better-auth admin plugin hoặc custom session row swap.
- QR code self-host via `qrcode` package (V1 dùng api.qrserver.com).
- Bull Board / run history chi tiết ở /admin/system/jobs (V1 chỉ queue counts).

**Tổng ước lượng**: 10 ngày dev cho 1 người. Có thể parallel Phase 2 + 3 nếu 2 dev.

---

## 10. UI/UX style guide

### 10.1. Theme

- **Default dark mode** (admin visual cue khác app).
- Accent: `slate-900` background, `zinc-100` text, `red-500` cho destructive, `amber-500` cho warning, `emerald-500` cho success.
- Font: cùng `Inter` của app + `JetBrains Mono` cho ID/timestamp/JSON payload.

### 10.2. Data density

- Bảng dày: row height 36px, padding 12px ngang, font-size 13px.
- Hover row → bg `slate-800/40`.
- Sort indicator: caret ▲▼ bên cạnh header column.
- Sticky table header khi scroll.

### 10.3. Components

- **Reuse từ app**: Button, Input, Dropdown, Avatar, Tooltip.
- **Riêng cho admin** (new):
  - `<AdminTable>` — sortable + paginate + bulk select
  - `<StatusBadge variant="ok|warn|danger" />`
  - `<ConfirmDialog reasonRequired />`
  - `<ImpersonateBanner />`
  - `<DiffViewer before={...} after={...} />` — show payload trong audit log
  - `<MetricTile label value delta sparkline />`

### 10.4. Empty state

Mỗi list page có empty state chuẩn:

```
┌─────────────────────────────┐
│      [icon lớn 64px]        │
│   Chưa có <resource> nào    │
│  Mô tả 1 câu giải thích     │
└─────────────────────────────┘
```

### 10.5. Loading state

- Skeleton table 5 hàng cho list view.
- Spinner 24px center cho detail page khi fetch.
- KHÔNG dùng full-screen overlay — admin scan nhanh, partial loading OK.

### 10.6. Error state

- Mọi API error → inline alert đỏ trên page (KHÔNG toast — admin cần thấy lại sau scroll).
- Format: `{ error: "Message", code: "ADMIN_xxx", traceId: "..." }` — traceId link sang Sentry.

---

## 11. Open questions

- [ ] Có cần multi-org / multi-tenant không? Phase 1 không, nhưng schema nên reserve `org_id` cột?
- [ ] Audit log retention bao lâu? Đề xuất: 1 năm hot trong Postgres, archive S3 sau.
- [ ] Impersonation có nên gửi email cho user bị impersonate không? Privacy vs surprise.
- [ ] 2FA bắt buộc ngay từ Phase 1 hay Phase 6?
- [ ] /maintenance landing page design ai làm? Reuse `/sign-in` style?

---

**Last updated**: 2026-05-19
**Status**: Draft v1 — chưa implement, file này là design spec để chốt scope trước khi code.
