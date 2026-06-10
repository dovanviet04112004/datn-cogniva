# Tutoring Marketplace V4 — "Conversational + Frictionless"

> Phase 21 V1-V3 đã ship listings + booking + payment + KYC. **V4 tập trung
> giảm friction & tăng conversion**: rút clicks, search bằng AI conversational,
> wallet + installment, recurring + group classes, trust signals đầy đủ.

**Trạng thái 2026-05-22:** spec, chưa start. Sau khi user duyệt → batch ship
theo roadmap §10.

---

## 1. Tại sao V4

V1-V3 đã có đủ tính năng cơ bản nhưng user phàn nàn:

| Friction điểm | Trải nghiệm hiện tại | Hậu quả |
|---|---|---|
| Tìm gia sư | Filter chip (subject + level + modality) → list grid → click profile từng cái → đối chiếu giá/rating thủ công | Mất 5-10 phút mỗi lần tìm |
| Đăng yêu cầu | Form 6 field (title, desc, subject, level, budget, urgency) | 70% user bỏ giữa chừng |
| Đặt buổi | Dialog 5 bước (subject → day → duration → time → message) → wait 24h tutor confirm | TTV cao, dropoff |
| Thanh toán | 1 booking = 1 lần thanh toán full, no wallet, no installment | Khoá học dài (8 buổi) → student phải book + pay 8 lần |
| Lịch | Linear list 7 ngày tới — không thấy buổi học cách 2 tuần | Không lên kế hoạch dài hạn |
| Match AI | Chỉ chạy khi mở `/requests/[id]/matches` — lazy compute, no chat | User không biết feature tồn tại |
| Trust | Self-claim experience + KYC badge nhỏ — không có "100+ buổi", "trả lời nhanh" | Khó so sánh tutor |

**Mục tiêu V4 (3 tháng):**
1. **TTV (Time-to-Value)**: từ click "Tìm gia sư" → confirmed booking ≤ 3 phút (hiện 10-15 phút)
2. **Booking completion rate**: từ 35% (V3) → 65%
3. **Repeat booking** trong 30 ngày: từ 18% → 45% (via recurring + wallet)
4. **AI conversational search adoption**: 40% session tìm gia sư qua chat
5. **Payment success rate** (capture/intent): 95% (hiện 85% do dropoff giữa intent → capture)

---

## 2. So sánh với marketplace khác

| Feature | Cogniva V3 | Toidi/Edumaster/Tutor.vn | Preply/iTalki (global) | V4 target |
|---|---|---|---|---|
| Search | Filter chips | Filter chips | NLP + AI suggest | ✅ Conversational AI |
| Instant book | ❌ (chờ 24h) | ❌ | ✅ Confirmed slots | ✅ "Sẵn sàng dạy ngay" badge |
| Recurring booking | ❌ | ❌ | ✅ Weekly/biweekly | ✅ Pack 4/8/12 buổi |
| Group classes | ❌ | ⚠️ (offline only) | ❌ | ✅ 1 tutor → N student |
| Wallet / credit | ❌ | ❌ | ✅ Pre-paid balance | ✅ VND wallet + cashback |
| Installment | ❌ | ⚠️ Manual qua admin | ❌ | ✅ Split N kỳ |
| Trial buổi | ❌ | ⚠️ Tuỳ tutor | ✅ 30 phút giá thấp | ✅ Trial 30 phút giảm 50% |
| Reviews v2 | Rating + comment | Rating + comment | Rating + tags + video | ✅ Tag filter + helpful count |
| Map view (offline) | ❌ | ✅ | N/A | ✅ Mapbox |
| Comparison side-by-side | ❌ | ❌ | ✅ Up to 4 | ✅ Up to 4 tutors |
| Saved searches / fav | ❌ | ⚠️ Bookmark profile | ✅ Saved + alerts | ✅ Both |
| Tutor responsiveness | ❌ | ❌ | ✅ "Replies in 2h" | ✅ Avg response time badge |

V4 đóng GAP với Preply/iTalki nhưng giữ thế mạnh **tích hợp study tool** (study group + voice + AI Tutor + flashcards auto-gen).

---

## 3. Roadmap 5 phase

### Phase T1 — AI Conversational Search + Instant Match (~5 ngày)
Mục tiêu: thay filter chips bằng chat tự nhiên + bring AI matching lên front.

**Features:**
- **AI Concierge chat panel** trên `/tutoring` (slide-in từ phải, Cmd+J shortcut)
- Conversational flow:
  1. User: "Tôi muốn học Toán cho con lớp 11"
  2. AI: hỏi clarify (budget? online/offline? level cụ thể?)
  3. AI: stream 3-5 tutor recommendation card kèm lý do match
  4. Click card → mở tutor profile / booking dialog
- **Streaming response** với tutor card render dần (SSE/Vercel AI SDK)
- Tool calls: `searchTutors(filters)`, `getTutorAvailability(id)`, `suggestRequest(brief)`
- **Pre-compute embedding** BullMQ cron 6h thay lazy compute (latency 2s → 200ms)
- **Hybrid search**: keyword FTS + vector cosine kết hợp (reciprocal rank fusion)
- **Smart filter chip extraction**: AI parse query "toán lớp 11 dưới 200k" → tự set chip filter để user thấy

**Schema thêm:**
```sql
-- Lưu conversation history concierge — separate từ AI Tutor để analytics riêng
CREATE TABLE tutoring_concierge_thread (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title text,
  last_message_at timestamp DEFAULT now(),
  -- Cache filter cuối user pick (subject/level/budget) để reopen tiếp tục
  extracted_filters jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE tutoring_concierge_message (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES tutoring_concierge_thread(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text NOT NULL,
  -- Tool call result jsonb {tutorIds: [...], score: [...]}
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

-- FTS tsvector cho tutor (bio + headline) — hiện chỉ pgvector
ALTER TABLE tutor_profile
  ADD COLUMN search_vec tsvector
    GENERATED ALWAYS AS (
      to_tsvector('simple', coalesce(bio, '') || ' ' || coalesce(headline, ''))
    ) STORED;
CREATE INDEX tutor_profile_search_idx ON tutor_profile USING GIN (search_vec);

-- Pre-computed embedding age tracker (BullMQ cron daily refresh)
ALTER TABLE tutor_profile ADD COLUMN bio_embedding_updated_at timestamp;
```

**API mới:**
```
POST /api/tutoring/concierge/threads          — tạo thread mới
GET  /api/tutoring/concierge/threads          — list threads của user
POST /api/tutoring/concierge/threads/[id]/messages  — gửi message, SSE stream
GET  /api/tutoring/concierge/search           — hybrid search (FTS + vector)
                                                ?q=&subject=&level=&budgetMax=&modality=
```

**UI:**
- `<TutoringConcierge>` panel: textarea + suggestion chips ("Toán 11", "IELTS 6.5", "Anh giao tiếp")
- `<TutorMatchCard>` render trong chat — collapsible, có CTA "Đặt thử 30 phút"
- Banner top `/tutoring`: "✨ Hỏi AI Concierge → tìm gia sư ngay" với CTA mở panel

---

### Phase T2 — Frictionless Booking + Instant Book (~4 ngày)
Mục tiêu: rút từ 5 bước → 1 bước cho 60% case, cho phép book ngay không chờ tutor confirm.

**Features:**
- **Smart Default Booking dialog** (1 step thay vì 5):
  - AI auto-pick: subject mặc định (tutor chỉ 1) + duration 60min + time slot gần nhất 24h
  - User chỉ cần confirm hoặc tweak
- **"Sẵn sàng dạy ngay" badge** — tutor opt-in cho phép student book mà không cần confirm thủ công
  - Trạng thái booking từ `PENDING_TUTOR` → `CONFIRMED` ngay
  - Tutor phải set `tutorProfile.instantBookEnabled = true`
- **Trial booking 30 phút giảm 50%** — pricing override khi student book lần đầu với tutor
  - DB constraint: 1 trial / pair (student, tutor)
- **Reschedule flow** — thay cancel→re-book, cho phép drag drop time slot trong calendar
  - Status mới: `RESCHEDULE_PROPOSED` → tutor accept → CONFIRMED time mới
- **Rate request** — student mong giá X, tutor counter-offer (giảm dần thanh thoả thuận chat)

**Schema thêm:**
```sql
ALTER TABLE tutor_profile
  ADD COLUMN instant_book_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN trial_session_enabled boolean NOT NULL DEFAULT true,
  -- Cached metric "phản hồi trong X phút" tính từ booking history
  ADD COLUMN avg_response_minutes integer,
  ADD COLUMN response_rate_pct integer; -- 0-100

ALTER TABLE tutoring_booking
  ADD COLUMN is_trial boolean NOT NULL DEFAULT false,
  ADD COLUMN original_start_at timestamp, -- track reschedule history
  ADD COLUMN reschedule_count integer NOT NULL DEFAULT 0;

-- Constraint: 1 trial / (student, tutor) pair
CREATE UNIQUE INDEX tutoring_booking_trial_uniq
  ON tutoring_booking (student_id, tutor_id)
  WHERE is_trial = true;
```

**API mới:**
```
POST /api/tutoring/bookings/quick    — instant-book endpoint, validate slot + instant_book_enabled
POST /api/tutoring/bookings/[id]/reschedule  — propose new time
POST /api/tutoring/bookings/[id]/counter-rate — tutor đề xuất giá khác
```

**UI:**
- BookingDialog redesign — **2 column layout**:
  - Left (60%): calendar 14-ngày grid + slot picker (visual heatmap màu theo độ trống)
  - Right (40%): order summary + instant-book CTA
- Inline "Đổi lịch" button trên booking page (drag time hoặc pick new slot dialog)
- Tutor card hiển thị badge "⚡ Đặt ngay" + "💬 Trả lời trong 30 phút"

---

### Phase T3 — Wallet + Installment + Smart Pricing (~5 ngày)
Mục tiêu: dòng tiền linh hoạt, giảm dropoff giữa intent→capture.

**Features:**
- **VND Wallet** — user nạp tiền 1 lần, book nhiều buổi không phải qua VNPay mỗi lần
  - Nạp tiền: 100K / 500K / 1M / 5M (preset) hoặc custom
  - Cashback 5% khi nạp ≥ 1M (promo, configurable)
  - Auto top-up tuỳ chọn (nạp thêm 500K khi balance < 100K)
- **Pack giảm giá** — gia sư đăng pack 4/8/12 buổi giảm 5/10/15%
  - Student mua pack 1 lần → trừ dần khi book
  - Recurring booking từ pack (mỗi tuần T3 7pm tới khi hết pack)
- **Installment 2/3/4 kỳ** — pack ≥ 5M có thể trả góp 0% (Cogniva cover phí qua wallet)
- **Auto-refund** — cancel ≥ 24h → wallet refund instant (không cần admin)
- **Smart pricing** — AI gợi ý giá theo subject + level + experience cho tutor mới
  - Compare percentile (cùng môn): tutor pricing ở P50, P75, P90
- **Promo code** — admin tạo code (vd: STUDENT2026) giảm % hoặc tặng wallet credit

**Schema thêm:**
```sql
-- Wallet account per user (1-1)
CREATE TABLE user_wallet (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  balance_vnd integer NOT NULL DEFAULT 0,
  -- Cashback / promo credit (có expiry, không rút được)
  promo_balance_vnd integer NOT NULL DEFAULT 0,
  auto_topup_threshold_vnd integer,
  auto_topup_amount_vnd integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Wallet ledger — audit + undo capability
CREATE TABLE user_wallet_txn (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'TOPUP', 'BOOKING_PAY', 'REFUND', 'CASHBACK', 'PROMO', 'PAYOUT_RECEIVED'
  )),
  amount_vnd integer NOT NULL, -- signed: + nạp / - chi
  balance_after_vnd integer NOT NULL,
  -- FK loose tới booking/topup/refund — không hard FK để allow soft delete
  related_id text,
  related_type text,
  description text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX user_wallet_txn_user_time_idx ON user_wallet_txn (user_id, created_at DESC);

-- Lesson pack — tutor đăng pack giảm giá
CREATE TABLE tutoring_pack (
  id text PRIMARY KEY,
  tutor_id text NOT NULL REFERENCES tutor_profile(id) ON DELETE CASCADE,
  subject_slug text NOT NULL,
  level text NOT NULL,
  session_count integer NOT NULL CHECK (session_count IN (4, 8, 12, 16, 24)),
  duration_min integer NOT NULL DEFAULT 60,
  rate_per_session_vnd integer NOT NULL, -- giá / buổi sau giảm
  total_vnd integer NOT NULL, -- =rate × count
  discount_pct integer NOT NULL DEFAULT 0, -- so với hourly_rate_vnd × count
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  description text,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Pack purchase by student
CREATE TABLE tutoring_pack_purchase (
  id text PRIMARY KEY,
  pack_id text NOT NULL REFERENCES tutoring_pack(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- Snapshot pack info tại lúc mua (pack có thể update sau)
  total_vnd integer NOT NULL,
  remaining_sessions integer NOT NULL,
  -- Installment config nếu chia kỳ
  installment_total_periods integer,
  installment_paid_periods integer NOT NULL DEFAULT 0,
  -- Recurring schedule (cron-like): "WEEKLY:TUE:19:00" hoặc null = manual book
  recurring_schedule text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'ACTIVE', 'EXHAUSTED', 'REFUNDED', 'EXPIRED'
  )),
  expires_at timestamp, -- mặc định created_at + 90 ngày
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX tutoring_pack_purchase_student_idx
  ON tutoring_pack_purchase (student_id, status);

-- Link booking với pack purchase (deduct remaining_sessions)
ALTER TABLE tutoring_booking
  ADD COLUMN pack_purchase_id text REFERENCES tutoring_pack_purchase(id);

-- Promo code
CREATE TABLE promo_code (
  code text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('PERCENTAGE', 'FIXED_VND', 'WALLET_CREDIT')),
  value integer NOT NULL,
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL DEFAULT 1,
  min_purchase_vnd integer,
  valid_from timestamp,
  valid_until timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE promo_code_redemption (
  promo_code text REFERENCES promo_code(code) ON DELETE CASCADE,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  redeemed_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (promo_code, user_id)
);
```

**API mới:**
```
GET    /api/wallet                    — balance + recent txn
POST   /api/wallet/topup              — tạo intent nạp tiền (VNPay/MoMo)
POST   /api/wallet/auto-topup         — config auto top-up
GET    /api/wallet/txn?cursor=&limit=

GET    /api/tutoring/packs?tutorId=   — list pack của tutor
POST   /api/tutoring/packs            — tutor tạo pack
POST   /api/tutoring/packs/[id]/purchase  — student mua pack (installment optional)

POST   /api/tutoring/promo/redeem     — apply promo code
POST   /api/tutoring/pricing/suggest  — AI gợi ý giá cho tutor mới
                                        body: { subjectSlug, level, experience }
```

**UI:**
- `/wallet` page: balance card + nạp tiền + txn history (filter type + date range)
- TutorProfile thêm tab "Pack giảm giá" → grid card pack với CTA "Mua pack -10%"
- BookingPaymentBox: 3 method tabs (Wallet | VNPay | MoMo) — default Wallet nếu đủ balance
- Tutor dashboard: form đăng pack (auto-suggest discount theo session_count)

---

### Phase T4 — Calendar V2 + Group Classes + Recurring (~6 ngày)
Mục tiêu: dạy nhiều student cùng lúc + lịch học định kỳ.

**Features:**
- **Calendar tuần/tháng view** — drag/drop reschedule, color theo subject
  - Tutor: thấy availability + booking + blocked time
  - Student: thấy upcoming + history + recurring schedule
- **Group classes** (1 tutor → 2-15 student)
  - Tutor đăng class: subject + level + max_students + price/student + schedule
  - Student join class (book seat)
  - Auto-create study group khi class start, group có channel #chung và #voice cho cả N student
- **Recurring booking** — auto-create 1 booking / tuần từ pack hoặc subscription
  - BullMQ cron daily: tạo booking PENDING_TUTOR cho recurring slot tuần tới
  - Tutor confirm 1 lần "auto-confirm all recurring" hoặc per-occurrence
- **Calendar export** — iCal feed (.ics URL token-protected) để sync Google/Outlook
- **Blocked time** — tutor mark vacation / busy, ko cho book trong khoảng đó
- **Waitlist** — class full → student vào waitlist, tự push lên khi có seat trống

**Schema thêm:**
```sql
CREATE TABLE tutoring_class (
  id text PRIMARY KEY,
  tutor_id text NOT NULL REFERENCES tutor_profile(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  subject_slug text NOT NULL,
  level text NOT NULL,
  max_students integer NOT NULL CHECK (max_students BETWEEN 2 AND 30),
  enrolled_count integer NOT NULL DEFAULT 0,
  rate_per_student_vnd integer NOT NULL,
  duration_min integer NOT NULL DEFAULT 90,
  total_sessions integer NOT NULL DEFAULT 1,
  schedule_type text NOT NULL CHECK (schedule_type IN ('ONE_OFF', 'WEEKLY', 'BIWEEKLY')),
  -- Format: "DAY:HH:MM" hoặc array vì có thể 2 buổi/tuần
  schedule_slots jsonb NOT NULL,
  start_date date NOT NULL,
  study_group_id text REFERENCES study_group(id), -- auto-create khi start
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  )),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE tutoring_class_enrollment (
  id text PRIMARY KEY,
  class_id text NOT NULL REFERENCES tutoring_class(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ENROLLED' CHECK (status IN (
    'ENROLLED', 'WAITLISTED', 'COMPLETED', 'DROPPED', 'REFUNDED'
  )),
  payment_id text REFERENCES tutoring_payment(id),
  enrolled_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_id)
);

CREATE INDEX tutoring_class_enrollment_class_idx
  ON tutoring_class_enrollment (class_id, status);

-- Blocked time (vacation / busy)
CREATE TABLE tutor_blocked_time (
  id text PRIMARY KEY,
  tutor_id text NOT NULL REFERENCES tutor_profile(id) ON DELETE CASCADE,
  start_at timestamp NOT NULL,
  end_at timestamp NOT NULL,
  reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

CREATE INDEX tutor_blocked_time_tutor_idx
  ON tutor_blocked_time (tutor_id, start_at);

-- iCal token cho export
ALTER TABLE tutor_profile ADD COLUMN ical_token text;
ALTER TABLE "user" ADD COLUMN booking_ical_token text;
```

**API mới:**
```
GET  /api/tutoring/classes                    — list group classes (filter subject/level/start_date)
POST /api/tutoring/classes                    — tutor tạo class
POST /api/tutoring/classes/[id]/enroll        — student join (+ payment)
POST /api/tutoring/classes/[id]/waitlist      — join waitlist khi full
DELETE /api/tutoring/classes/[id]/enrollment  — student drop

GET  /api/tutoring/calendar/me?from=&to=&view=week|month  — tutor/student calendar
POST /api/tutoring/blocked-time               — block vacation
DELETE /api/tutoring/blocked-time/[id]
GET  /api/tutoring/ical/[token].ics           — iCal feed (public token URL)

# Recurring helper — cron job tạo booking ahead 7 ngày
# BullMQ job tutoring-recurring-rollout (daily 00:00 UTC)
```

**UI:**
- `/tutoring/calendar` page — full calendar view (FullCalendar / custom grid)
- `/tutoring/classes` tab thứ 4 trong hub — browse group classes
- TutorDashboard: nút "Tạo lớp nhóm" + form (subject/level/max/price/schedule)
- ClassDetailPage: roster + waitlist + study group preview
- Settings → "Calendar export" → copy iCal URL

---

### Phase T5 — Trust & Discovery polish (~4 ngày)
Mục tiêu: comparison + reviews v2 + saved searches.

**Features:**
- **Side-by-side comparison** — chọn 2-4 tutor → mở compare view (price, rating, response time, subjects, sample sessions)
- **Reviews v2**:
  - Tag categories (helpful, knowledgeable, patient, on-time) — student tick chips
  - Helpful count (other students like review)
  - Photo / video attachment (R2 upload)
  - Filter (5★/4★/3- / có content / có ảnh / mới nhất)
- **Saved searches + alerts** — user lưu filter, push notif khi có tutor mới match
- **Favorites** — heart button trên tutor card → list `/tutoring?tab=favorites`
- **Trust badges** (auto-derived):
  - "100+ buổi đã hoàn thành"
  - "Phản hồi trong 30 phút"
  - "Rating 4.8+ trong 30 ngày"
  - "Top 10 môn Toán THPT"
  - "Đã verify môn này" (V3 quiz)
- **Tutor responsiveness metrics** — cron tính avg response time + response rate hàng ngày
- **Public profile share** — `/tutors/[id]` SEO meta + OG image generate qua satori
- **Tutor video intro** — MP4 upload 60s, render trên profile card

**Schema thêm:**
```sql
-- Reviews v2 — extend tutor_review
ALTER TABLE tutor_review
  ADD COLUMN tags text[] DEFAULT '{}', -- ['helpful','knowledgeable','patient','on-time','clear','engaging']
  ADD COLUMN helpful_count integer NOT NULL DEFAULT 0,
  ADD COLUMN attachments jsonb, -- [{type:'image',url,thumbUrl}]
  ADD COLUMN is_hidden boolean NOT NULL DEFAULT false; -- admin moderation

CREATE TABLE tutor_review_helpful (
  review_id text NOT NULL REFERENCES tutor_review(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, user_id)
);

-- Saved search per user
CREATE TABLE tutor_saved_search (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL,
  filters jsonb NOT NULL, -- {subject,level,budgetMax,modality,city}
  alert_enabled boolean NOT NULL DEFAULT false,
  last_notified_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Tutor favorites
CREATE TABLE tutor_favorite (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tutor_id text NOT NULL REFERENCES tutor_profile(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tutor_id)
);

-- Tutor video intro (90s max)
ALTER TABLE tutor_profile ADD COLUMN intro_video_url text;
ALTER TABLE tutor_profile ADD COLUMN intro_video_thumb_url text;
```

**API mới:**
```
POST   /api/tutoring/compare         — body: { tutorIds: [] } → trả side-by-side data
POST   /api/tutors/[id]/favorite     — toggle favorite
GET    /api/tutoring/favorites       — list favorites của user

GET    /api/tutoring/saved-searches
POST   /api/tutoring/saved-searches
DELETE /api/tutoring/saved-searches/[id]
POST   /api/tutoring/saved-searches/[id]/toggle-alert

POST   /api/tutoring/reviews/[id]/helpful  — toggle helpful
POST   /api/tutoring/reviews/[id]/attachments  — upload photo
```

**UI:**
- TutorCard: checkbox "So sánh" → floating bar dưới "So sánh 3 tutor" → mở /tutoring/compare?ids=
- /tutoring/compare page: 4 column side-by-side table (price/rating/response/subjects)
- ReviewList: tag filter chips + sort dropdown + photo lightbox
- TutorProfile: video intro player ở hero + badge row sticky
- Notification bell: "🔔 3 gia sư mới match search lưu của bạn"

---

## 4. Schema migrations

Migration order khi start V4:

| # | Migration | Phase | Apply order |
|---|---|---|---|
| 0040 | `concierge_threads_messages` + tsvector tutor_profile | T1 | 1 |
| 0041 | `instant_book_columns + reschedule + trial` | T2 | 2 |
| 0042 | `wallet_packs_promo` | T3 | 3 |
| 0043 | `classes_blocked_time_recurring` | T4 | 4 |
| 0044 | `reviews_v2_favorites_saved_searches` | T5 | 5 |

Total ~5 migration. Batch ship — apply chung qua docker exec script.

---

## 5. AI Conversational Search — chi tiết

### 5.1. Mastra agent design

```ts
// apps/web/src/lib/ai/agents/tutoring-concierge.ts
export const tutoringConciergeAgent = new Agent({
  name: 'tutoring-concierge',
  instructions: `
Bạn là trợ lý tìm gia sư cho Cogniva. Hỏi user về:
- Môn học cần (Toán, Lý, Hoá, IELTS, ...)
- Cấp (lớp 11, đại học, người đi làm)
- Ngân sách / buổi (VND)
- Online hay offline (TP nào)
- Thời gian học (sáng/chiều/tối, ngày trong tuần)
- Đặc biệt: yếu phần nào, mục tiêu

Khi đủ thông tin → call \`searchTutors\` tool, render kết quả.
Nếu thiếu thông tin → hỏi 1-2 câu clarify, KHÔNG hỏi dồn dập.
Giọng văn thân thiện, tiếng Việt tự nhiên.
  `,
  tools: {
    searchTutors: {
      description: 'Tìm gia sư match yêu cầu',
      parameters: z.object({
        subjectSlug: z.string(),
        level: z.string(),
        budgetMaxVnd: z.number().optional(),
        modality: z.enum(['ONLINE', 'OFFLINE_HN', 'OFFLINE_HCM', 'HYBRID']).optional(),
        keyword: z.string().optional(), // 'luyện đề', 'cô gentle', 'team teaching'
      }),
      execute: hybridSearchTutors, // FTS + cosine fusion
    },
    getTutorDetails: { /* ... */ },
    suggestBudget: { /* P50/P75 stats */ },
  },
});
```

### 5.2. Hybrid search algorithm

Reciprocal rank fusion (RRF) — combine FTS rank và vector cosine rank:

```sql
WITH fts_ranks AS (
  SELECT id, RANK() OVER (ORDER BY ts_rank(search_vec, query) DESC) as fts_rank
  FROM tutor_profile, to_tsquery('simple', :q) query
  WHERE status = 'PUBLISHED'
    AND search_vec @@ query
  LIMIT 50
),
vector_ranks AS (
  SELECT id, RANK() OVER (ORDER BY bio_embedding <=> :q_embed) as vec_rank
  FROM tutor_profile
  WHERE status = 'PUBLISHED'
    AND bio_embedding IS NOT NULL
  LIMIT 50
)
SELECT
  COALESCE(f.id, v.id) as id,
  -- RRF: score = sum(1 / (k + rank)), k=60
  1.0 / (60 + COALESCE(f.fts_rank, 1000)) +
  1.0 / (60 + COALESCE(v.vec_rank, 1000)) as score
FROM fts_ranks f
FULL OUTER JOIN vector_ranks v USING (id)
ORDER BY score DESC
LIMIT 10;
```

Kết hợp filter (subject/level/budget) qua WHERE clauses thêm.

### 5.3. Tool result format

`searchTutors` returns:
```json
{
  "tutors": [
    {
      "id": "...",
      "name": "...",
      "headline": "...",
      "rateVnd": 200000,
      "rating": 4.8,
      "matchReason": "Dạy Toán 11 đã 3 năm, chuyên luyện đề trắc nghiệm — match query 'luyện đề'",
      "matchScore": 0.87
    }
  ],
  "totalMatches": 24,
  "filters": { ... } // echo back để client render chip
}
```

`matchReason` AI tự generate dựa trên bio + query — show inline với tutor card → user hiểu vì sao recommend.

---

## 6. Payment Optimization — chi tiết

### 6.1. Wallet first flow

Trước V4: Booking → VNPay intent → redirect → capture webhook → confirmed. Failure rate ~15%.

V4: Booking → check wallet balance:
- Đủ → trừ wallet ngay, status=CAPTURED (no external call)
- Không đủ → modal "Nạp 200K để hoàn tất + 50K dư cho lần sau" → 1 VNPay flow vẫn dùng được

Lợi ích:
- Repeat student: 1 VNPay charge cover 5-10 booking
- Refund instant qua wallet credit, không qua VNPay refund (3-7 days)
- Reduce VNPay/MoMo transaction fees ~70%

### 6.2. Installment flow

User mua pack 8 buổi giá 1.6M, chia 4 kỳ (400K/kỳ, mỗi 2 tuần):

| Period | Trigger | Action |
|---|---|---|
| 1 | Mua pack | Charge 400K (wallet hoặc VNPay), pack ACTIVE, 8 buổi available |
| 2 | After 14 days | BullMQ cron charge 400K wallet auto; nếu wallet < 400K → email + push "nạp ngay" |
| 3 | After 28 days | Same |
| 4 | After 42 days | Same — paid_periods = 4 → pack PAID_FULL |

Nếu fail kỳ 2 → grace 7 ngày → student không nạp → pause pack (block booking) → 14 ngày → refund + cancel còn lại.

### 6.3. Refund matrix

| Trigger | Within | Refund % | To |
|---|---|---|---|
| Student cancel | >24h before | 100% | Wallet (instant) |
| Student cancel | 1-24h before | 90% | Wallet (instant) |
| Student cancel | <1h before | 0% | (Tutor get full) |
| Tutor cancel | Any time | 100% + 10% credit | Wallet (instant) + promo credit cho lần sau |
| No-show student | After 15min | 0% | Tutor get full |
| No-show tutor | After 15min | 100% + 20% credit | Wallet + promo |
| Dispute (admin review) | Within 7 days post | Case-by-case | Admin decide |

---

## 7. UI/UX cải tiến — chi tiết

### 7.0. Information Architecture mới

**Sidebar entry "Gia sư"** giữ nguyên 1 link. Mở ra Hub `/tutoring` với cấu trúc:

```
/tutoring                         (Hub — 5 tab)
├── ?tab=tutors                   (default) — browse + AI Concierge
├── ?tab=classes                  (V4 mới) — group classes
├── ?tab=requests                 — student requests
├── ?tab=favorites                (V4 mới) — saved tutors + searches
└── ?tab=mine                     — my profile + bookings + earnings

/tutors/[id]                      — tutor profile detail
/tutors/[id]/book                 (V4 mới, modal/route) — booking flow
/tutors/become                    — onboarding wizard
/tutoring/classes/[id]            (V4 mới) — class detail
/tutoring/bookings/[id]           — booking detail
/tutoring/requests/[id]           — request detail
/tutoring/calendar                (V4 mới) — full calendar view
/wallet                           (V4 mới) — wallet + ledger
/tutoring/compare?ids=a,b,c       (V4 mới) — side-by-side
```

URL state là single source of truth (filter, tab, compare ids) → shareable, back/forward hoạt động.

### 7.1. Design tokens (sync với theme hiện có)

Reuse system tokens của Cogniva, KHÔNG tạo bộ token riêng:

```css
/* Spacing: 4/8/12/16/24/32 (existing tailwind scale) */
/* Colors:                                              */
--primary             /* Indigo 600 — CTA, active state */
--success             /* Emerald 600 — confirmed, available */
--warning             /* Amber 500 — pending, low stock */
--destructive         /* Red 600 — cancel, urgent */
--accent-discovery    /* Violet 500 — AI Concierge, new (V4 thêm) */

/* Typography:                                          */
text-[10.5px]         /* meta, badge */
text-xs (12px)        /* secondary */
text-sm (14px)        /* body */
text-base (15-16px)   /* body large */
text-lg (18px)        /* heading 3 */
text-xl (20px)        /* heading 2 */
text-2xl-3xl          /* hero only */

/* Border radius:                                       */
rounded-md (6px)      /* small chip, badge */
rounded-lg (8px)      /* button, input */
rounded-xl (12px)     /* card */
rounded-2xl (16px)    /* hero, payment box */
rounded-full          /* avatar, chip filter */

/* Elevation:                                           */
shadow-soft           /* card default */
shadow-elevated       /* dropdown, modal */
shadow-glow           /* hover CTA primary */
```

**V4 thêm 1 màu mới:** `--accent-discovery` (violet 500) chỉ dùng cho AI features (Concierge, smart suggestion, AI badge) — để user nhận diện AI feature instantly.

### 7.2. Hub `/tutoring` redesign — mockup chi tiết

**Trước (V3):**
- Hero band cao 200px chiếm 30% màn hình
- 3 tab horizontal underline
- Filter chip row riêng (subject + level + modality)
- Grid 3 column card

**Sau (V4) — ASCII mockup desktop ≥1024px:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [≡] Cogniva   ←Topbar (đã có)                              [🔔] [👤]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ╔═════════════════════════════════════════════════════════════════╗   │
│  ║ ✨ Hỏi AI Concierge: "Tôi muốn học Toán lớp 11..." [Cmd+J]   ▷║   │  ← sticky search bar
│  ╚═════════════════════════════════════════════════════════════════╝   │     accent-discovery glow
│                                                                          │
│  Tutoring Marketplace                                                   │
│  Tìm gia sư · Lớp nhóm · Yêu cầu học                                   │  ← hero (giảm 50% height)
│                                          [+ Đăng yêu cầu] [Trở thành]  │
│                                                                          │
│  ┌─ Tutors ──── Classes ── Requests ── ♥ Favorites ── Mine ──────────┐ │  ← tab pills
│  │              ●                                                      │ │
│  │                                                                     │ │
│  │ 📚 Môn: Tất cả ▾   🎯 Cấp: ▾   💰 Giá: 50k─500k ●━●               │ │  ← filter bar (collapsible)
│  │ 🖥 Online · 📍 HN · 📍 HCM · 🔀 Hybrid     [⚙ Lọc nâng cao] [Xoá] │ │
│  │                                                                     │ │
│  │ Sort: ⭐ AI Match ▾    320 gia sư    [⊞ Grid] [≡ List] [□ Compare]│ │  ← result toolbar
│  │                                                                     │ │
│  │ ┌─ TutorCard ─┐ ┌─ TutorCard ─┐ ┌─ TutorCard ─┐ ┌─ TutorCard ─┐ │ │
│  │ │ [photo + ⚡]│ │ [photo + ⭐]│ │ [photo + ✓]│ │ [photo]      │ │ │  ← grid 4 col
│  │ │ Cô Lan ♥□  │ │ Thầy Hùng ♥│ │ Cô Mai ♥□  │ │ Thầy Đức ♥□ │ │ │
│  │ │ Toán THPT  │ │ Vật lý ĐH  │ │ Anh giao..│ │ Lập trình   │ │ │
│  │ │ ⭐ 4.9 (24)│ │ ⭐ 4.8 (51)│ │ ⭐ 5.0 (12)│ │ ⭐ 4.7 (8)  │ │ │
│  │ │ 180k/giờ   │ │ 250k/giờ   │ │ 200k/giờ   │ │ 220k/giờ    │ │ │
│  │ │ ⚡Đặt ngay│ │ 💬 30 phút │ │ ✓ Verified│ │ 🎯 Top 10   │ │ │
│  │ │[Đặt buổi] │ │[Đặt buổi] │ │[Đặt buổi] │ │[Đặt buổi]  │ │ │
│  │ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │ │
│  │                                                                     │ │
│  │ [Tải thêm 12 gia sư]                                               │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│         [● ● Compare (2)]  ← floating compare cart khi user check       │
└─────────────────────────────────────────────────────────────────────────┘
```

**Mobile (<640px) — hero giảm tiếp, sticky search bar luôn ở top:**

```
┌──────────────────────┐
│ [≡]  Cogniva    [🔔] │
├──────────────────────┤
│ ✨ Hỏi AI Concierge  │
├──────────────────────┤
│ Tutors · Classes ··  │ ← tab horizontal scroll
│   ●                  │
├──────────────────────┤
│ Môn ▾  Giá ▾  Lọc ▾ │ ← filter chip
├──────────────────────┤
│ ┌──────────────────┐ │
│ │ [photo]    ♥     │ │
│ │ Cô Lan           │ │
│ │ ⭐ 4.9 · 180k/h │ │
│ │ ⚡ Đặt ngay      │ │
│ │ [Đặt buổi]       │ │
│ └──────────────────┘ │ ← 1 column card
│ ┌──────────────────┐ │
│ │ ...              │ │
└──────────────────────┘
```

**Component spec — `<TutorCard>`:**

```
┌────────────────────────────────────┐
│ ┌────┐ Cô Lan                  ♥ □ │ ← favorite + compare checkbox
│ │ 📷 │ Gia sư Toán THPT 5 năm KN  │
│ │    │ ⭐ 4.9 (24) · 100+ buổi   │
│ └────┘                              │
│ ⚡ Đặt ngay  💬 30p  ✓ Verified  │ ← trust badge row (max 3)
│ Toán 10-12 · Lý 11-12 + 2 môn nữa │ ← subjects (truncate 2)
│ ─────────────────────────────────── │
│  180.000đ/giờ        [Đặt buổi]   │ ← bottom CTA
└────────────────────────────────────┘
```

Hover state:
- Card lift `translate-y-[-2px]` + `shadow-elevated`
- Photo zoom 1.05 (smooth 200ms)
- Hidden tertiary action reveals: "Lưu" + "Nhắn DM" + "Xem profile"

### 7.3. TutorProfile `/tutors/[id]` redesign

**Mockup desktop:**

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Quay lại  [♥ Lưu]  [⊞ So sánh]  [Chia sẻ]                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│ ┌─ Main col (60%) ─────────────────────┐ ┌─ Sticky col (40%) ────┐ │
│ │                                       │ │                         │ │
│ │ ┌─ Video intro (16:9) ──────────────┐│ │ ┌─ Booking card ──────┐│ │
│ │ │                                    ││ │ │ Từ 150.000đ/giờ    ││ │ ← sticky right
│ │ │     [▶ 0:42 / 1:00]                ││ │ │                     ││ │
│ │ │                                    ││ │ │ ⏰ Slot gần nhất:  ││ │
│ │ └────────────────────────────────────┘│ │ │ T5 ngày 25 · 19:00 ││ │
│ │                                       │ │ │                     ││ │
│ │ [photo] Cô Nguyễn Lan                │ │ │ [⚡ Đặt ngay 60p]   ││ │
│ │         ⭐ 4.9 (24 reviews)          │ │ │ [Trial 30p -50%]    ││ │
│ │         Toán THPT · 5 năm kinh nghiệm│ │ │ [Mua pack 8 buổi]   ││ │
│ │                                       │ │ │  -10%               ││ │
│ │ ✓ Verified KYC  ⚡ Đặt ngay         │ │ │                     ││ │
│ │ 💬 Phản hồi 30 phút  🎯 Top 10 Toán │ │ │ [💬 Nhắn tin]       ││ │
│ │                                       │ │ └─────────────────────┘│ │
│ │ ┌─ Tab nav ──────────────────────────┐│ │                         │ │
│ │ │ Giới thiệu · Môn · Lịch · Pack · Đánh giá ││  ┌─ Trust ─────────┐│ │
│ │ └─ ●                                ───┘│ │  │ Đã hoàn thành    ││ │
│ │                                       │ │  │ 127 buổi học     ││ │
│ │ <Tab content scroll>                  │ │  │                   ││ │
│ │                                       │ │  │ Phản hồi trung    ││ │
│ │ Tôi tốt nghiệp Toán ĐH Sư phạm...   │ │  │ bình: 28 phút    ││ │
│ │                                       │ │  │                   ││ │
│ │ ...                                   │ │  │ Tỷ lệ confirm:   ││ │
│ │                                       │ │  │ 98%               ││ │
│ │                                       │ │  └───────────────────┘│ │
│ └───────────────────────────────────────┘ └────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Mobile:** sticky bottom CTA bar — "150k/h · [Đặt buổi]" — không floating button rời.

**Tab content sections:**

| Tab | Content | Sticky? |
|---|---|---|
| Giới thiệu | Markdown bio + intro video | No |
| Môn | Grid môn (emoji + level + verified badge + sessions taught) | No |
| Lịch | Mini calendar 14 ngày + chỉ slot trống | No |
| Pack | Pack 4/8/12 buổi cards + CTA "Mua" | No |
| Đánh giá | Reviews v2 list + tag filter | No |

**Subtle interaction:**
- Scroll past hero → tab nav `position: sticky top-14` để luôn thấy
- Sticky CTA right panel chỉ hiển thị desktop ≥ 1024px

### 7.4. BookingDialog redesign — 1 step smart

**Trước (V3):** 5 vertical block (subject → day → duration → time → message) ~ 720px height, 5 click.

**Sau (V4):** 2-column compact dialog ~ 480px height, **1 click confirm** cho 60% case.

```
┌─ Đặt buổi với Cô Lan ──────────────────────────────── × ┐
│                                                          │
│ ┌─ Left (calendar 60%) ──┐ ┌─ Right (summary 40%) ────┐ │
│ │ Tháng 5 ▾    < >       │ │ 📚 Toán 11             │ │
│ │ T2 T3 T4 T5 T6 T7 CN  │ │                          │ │
│ │ 23 24 25 26 27 28 29  │ │ ⏰ T6 27/5  19:00 - 20:00│ │
│ │ ░░ ▓▓ ░░ ██ ░░ ░░ ▓▓  │ │     (60 phút)           │ │
│ │ ── ▓▓ ── ██ ── ── ▓▓  │ │                          │ │
│ │ 30 31  1  2  3  4  5  │ │ 💰 180.000đ              │ │
│ │ ▓▓ ▓▓ ░░ ░░ ░░ ░░ ░░  │ │                          │ │
│ │                        │ │ ┌──────────────────────┐│ │
│ │ ●  Trống  ●  Đã book  │ │ │ □ Trial 30p (-50%)   ││ │
│ │ ●  Khả dụng nhiều      │ │ │   Lần đầu với cô     ││ │
│ │                        │ │ │   Lan — chỉ 90k      ││ │
│ │ Slot 27/5:             │ │ └──────────────────────┘│ │
│ │ ○ 19:00  ● 19:30  ○ 20:00│ │                       │ │
│ │ ○ 20:30  ○ 21:00       │ │ □ Lặp lại hàng tuần    │ │
│ │                        │ │   (tự động đặt 4-8 buổi)│ │
│ │                        │ │                          │ │
│ │                        │ │ 💬 Lời nhắn (tuỳ chọn)  │ │
│ │                        │ │ [_____________________] │ │
│ │                        │ │                          │ │
│ │                        │ │ ┌──────────────────────┐│ │
│ │                        │ │ │ ⚡ Đặt ngay 180k     ││ │ ← CTA primary
│ │                        │ │ └──────────────────────┘│ │
│ │                        │ │ Huỷ free trước 24h    │ │ ← microcopy reassure
│ └────────────────────────┘ └──────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

**Heatmap màu cell:** ░ trống / ▓ đã có 1-2 buổi / █ kín / `──` không khả dụng (ngoài giờ tutor).

**Mobile:** stack vertical — calendar trên, summary dưới, sticky CTA dưới cùng.

**Smart prefill logic:**
1. Subject: auto chọn nếu tutor chỉ dạy 1 môn; nếu nhiều → AI chọn theo last booking subject của student
2. Duration: 60 phút default; user toggle 90/120 trong summary
3. Time: AI pick slot gần nhất ≥ 24h sau (gợi ý highlight cyan)
4. Trial checkbox auto-check nếu eligible (chưa từng book tutor này)

**Reschedule mode** dùng same dialog với `mode="reschedule"`:
- Banner amber: "Đổi lịch buổi 27/5 19:00 → chọn slot mới"
- Validate ≥ 12h before original time
- CTA: "Đề xuất đổi lịch" (tutor accept → applied)

### 7.5. Concierge panel — full spec

**Trigger:**
- Floating gradient pill ở góc dưới phải `/tutoring` (accent-discovery glow)
- Cmd+J / Ctrl+J shortcut
- Smart search bar top click

**Layout desktop:** right slide-in 420px, mobile full-screen takeover.

```
┌─ ✨ AI Concierge ───────────────────── ⋮  × ┐
│ ┌─ Sub-header ─────────────────────────────┐│
│ │ [+ Cuộc mới]  Cuộc gần đây: Toán 11 ▾  ││
│ └───────────────────────────────────────────┘│
│                                                │
│ <Empty state khi mới mở>                      │
│                                                │
│   🎯 Mình giúp bạn tìm gia sư phù hợp        │
│                                                │
│   Thử bắt đầu:                                │
│   [Học Toán lớp 11 dưới 200k]                │
│   [Luyện IELTS speaking 6.5+]                │
│   [Học Lập trình Python cho người mới]       │
│   [Vẽ tranh cho trẻ 8 tuổi]                  │
│                                                │
│ <After 1st message:>                          │
│                                                │
│ ┌─ message bubble user ────────────────────┐ │
│ │ Tôi muốn học Toán cho con lớp 11        ││ │
│ └──────────────────────────────────────────┘ │
│                                                │
│ ┌─ message bubble AI (streaming) ──────────┐ │
│ │ ✨ Mình cần biết thêm chút:              ││ │
│ │ Ngân sách / buổi của bạn là khoảng?      ││ │
│ │                                            ││ │
│ │ [Dưới 150k] [150-250k] [250-400k] [Khác]  ││ │ ← suggestion chip click → auto-send
│ └──────────────────────────────────────────┘ │
│                                                │
│ ┌─ AI: "Đã tìm 4 gia sư match" ────────────┐ │
│ │ 🎯 4 gia sư phù hợp nhất:                ││ │
│ │ ┌─ Cô Lan · Toán 11 ──────────────────┐  ││ │ ← inline TutorMatchCard
│ │ │ [📷] ⭐ 4.9 (24) · 180k/h           │  ││ │   collapsible
│ │ │ 💡 "Chuyên luyện đề trắc nghiệm     │  ││ │   match reason highlight
│ │ │     — match query 'lớp 11'"          │  ││ │
│ │ │ [⚡ Đặt ngay 180k] [Trial 90k] [▾] │  ││ │
│ │ └──────────────────────────────────────┘  ││ │
│ │ ┌─ Thầy Hùng · Toán 11 ───────────────┐  ││ │
│ │ │ ...                                   │  ││ │
│ │ └──────────────────────────────────────┘  ││ │
│ │ [Xem 12 gia sư khác →]                    ││ │
│ └──────────────────────────────────────────┘ │
│                                                │
│ ─────────────────────────────────────────────│
│ [@] [Nhập yêu cầu...]              [⏎ Gửi]  │ ← input
│ Suggestions: [Đổi giá] [Chỉ online] [Sáng]   │ ← context chips
└────────────────────────────────────────────────┘
```

**Microcopy spec (concierge):**
- Empty state: "Mình giúp bạn tìm gia sư phù hợp" — KHÔNG "Tôi" (xa cách)
- AI clarify question: dưới 80 ký tự, chỉ 1 câu hỏi / turn
- Match reason: "💡 ... — match query 'X'" để user thấy AI lý do
- Loading state: "✨ Đang tìm..." với pulsing dots
- No match: "Chưa tìm thấy gia sư khớp 100%. Bạn có thể [Đăng yêu cầu](/tutoring/requests/new) để gia sư đề xuất ngược."

### 7.6. Compare view `/tutoring/compare?ids=`

**Mockup:**

```
┌──────────────────────────────────────────────────────────────┐
│ ← Quay lại    So sánh 3 gia sư                              │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│            │ Cô Lan      │ Thầy Hùng   │ Cô Mai          ×  │ ← remove
│ ───────────┼─────────────┼─────────────┼────────────────────│
│ Ảnh        │ [photo]     │ [photo]     │ [photo]            │
│ Headline   │ Gia sư Toán │ Vật lý ĐH   │ IELTS speaking     │
│ Giá / giờ  │ 180k        │ 250k        │ 200k               │
│ Pack 8 buổi│ 1.3M (-10%) │ 1.8M (-10%) │ 1.4M               │
│ Rating     │ ⭐ 4.9      │ ⭐ 4.8      │ ⭐ 5.0             │
│ Sessions   │ 127         │ 254         │ 38                 │
│ Response   │ 28 phút     │ 1 giờ       │ 12 phút            │
│ Verified   │ ✓ KYC + môn │ ✓ KYC       │ ✓ KYC + môn       │
│ Modality   │ Online      │ Hybrid HN   │ Online             │
│ Subjects   │ Toán 10-12  │ Lý 11-12, ĐH│ IELTS + Anh GT     │
│ Lịch sớm   │ T6 19:00    │ Mai 18:00   │ Trưa nay 13:00 ⚡  │
│ ───────────┼─────────────┼─────────────┼────────────────────│
│            │ [Đặt buổi]  │ [Đặt buổi]  │ [Đặt buổi]         │
└──────────────────────────────────────────────────────────────┘
```

**Row highlight tự động:** value tốt nhất mỗi row tô màu emerald nhẹ (giá thấp nhất, rating cao nhất, response nhanh nhất) — visual scan nhanh.

### 7.7. Calendar V2 view `/tutoring/calendar`

**Week view (default):**

```
┌──────────────────────────────────────────────────────────────────┐
│ ← T5 2026 →    [Week ▾]  [Today]      [+ Block time] [📤 iCal] │
├──────────────────────────────────────────────────────────────────┤
│       T2 23   T3 24   T4 25   T5 26   T6 27   T7 28   CN 29     │
│ 08:00 ┊      ┊      ┊      ┊      ┊      ┊      ┊              │
│ 09:00 ┊      ┊      ┊      ┊      ┊      ┊      ┊              │
│ 10:00 ┊      ┊      ┊      ┊      ┊ ┌──┐ ┊      ┊              │
│ 11:00 ┊      ┊      ┊      ┊      ┊ │📚│ ┊      ┊              │
│ 12:00 ┊      ┊      ┊      ┊      ┊ │Lý│ ┊      ┊  ← booking block
│ 13:00 ┊      ┊      ┊      ┊      ┊ └──┘ ┊      ┊
│ 14:00 ┊      ┊      ┊      ┊      ┊      ┊      ┊
│ 15:00 ┊ ╔══╗ ┊      ┊      ┊      ┊      ┊      ┊
│ 16:00 ┊ ║Lp║ ┊      ┊      ┊      ┊      ┊      ┊  ← Class block (đen)
│ 17:00 ┊ ╚══╝ ┊      ┊      ┊      ┊      ┊      ┊
│ 18:00 ┊      ┊      ┊      ┊      ┊      ┊ ┌──┐ ┊
│ 19:00 ┊      ┊ ▓▓▓▓ ┊      ┊      ┊      ┊ │To│ ┊  ← Available slot (grey)
│ 20:00 ┊      ┊ ▓▓▓▓ ┊      ┊      ┊      ┊ └──┘ ┊
│ 21:00 ┊      ┊      ┊      ┊      ┊      ┊      ┊
└──────────────────────────────────────────────────────────────────┘
```

- **Color code:**
  - Booking 1-1: indigo
  - Class nhóm: violet (accent-discovery)
  - Available slot trống: muted grey hatching
  - Blocked time: red striped
  - Pending tutor confirm: amber outline dashed
- **Drag-drop reschedule** (V4 nice-to-have): grab block → drag tới slot mới → confirm dialog
- **Month view**: chuyển sang grid 7×5 với badge count per day

### 7.8. Wallet `/wallet` page

```
┌─────────────────────────────────────────────────────────┐
│ Ví của tôi                              [Lịch sử ↓]    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ┌─ Balance card ───────────────────────────────────────┐│
│ │ Số dư khả dụng                                       ││
│ │ 1.250.000 đ                                          ││  ← display lớn
│ │ + 50.000đ promo credit (hết hạn 30/6)               ││  ← promo separate
│ │                                                       ││
│ │ [+ Nạp tiền] [⚙ Auto top-up: Off]                  ││
│ └──────────────────────────────────────────────────────┘│
│                                                          │
│ ┌─ Recent activity ─────────────────────────────────────┐│
│ │ 📥 Nạp 500.000đ           VNPay  20/5 14:23   +500k││
│ │ 📤 Đặt buổi Toán 11      Cô Lan  19/5 19:00   -180k││
│ │ ↩  Hoàn tiền huỷ buổi    Cô Mai  18/5 21:00   +200k││
│ │ 🎁 Cashback nạp 1M       Promo   15/5         +50k ││
│ │ ...                                                    ││
│ │ [Xem tất cả →]                                        ││
│ └───────────────────────────────────────────────────────┘│
│                                                          │
│ ┌─ Promo code ──────────────────────────────────────────┐│
│ │ Có mã giảm giá? [_______________] [Áp dụng]          ││
│ └───────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 7.9. Reviews v2 component

```
┌─ Đánh giá ────────────────────────────── 24 đánh giá ⭐4.9 ┐
│                                                              │
│ Phân loại:                                                  │
│ ⭐⭐⭐⭐⭐ 18  ⭐⭐⭐⭐ 5  ⭐⭐⭐ 1  ⭐⭐ 0  ⭐ 0          │ ← rating distribution
│                                                              │
│ Phổ biến: [Patient ×12] [Knowledgeable ×8] [On-time ×6]    │ ← tag filter
│                                                              │
│ Sort: [Mới nhất ▾]  Filter: [Tất cả ▾] [Có ảnh □]          │
│ ─────────────────────────────────────────────────────────── │
│                                                              │
│ ┌─ Review ────────────────────────────────────────────────┐ │
│ │ ⭐⭐⭐⭐⭐  Đăng 3 ngày trước                            │ │
│ │ [👤] Nguyễn Văn A · Toán 11 · 4 buổi đã học           │ │
│ │                                                          │ │
│ │ Cô Lan dạy rất tận tâm, giải thích từng bước rõ ràng. │ │
│ │ Sau 4 buổi mình tự tin hơn hẳn với tích phân.          │ │
│ │                                                          │ │
│ │ [Patient] [Knowledgeable] [Clear]                       │ │ ← tag chips
│ │                                                          │ │
│ │ [📷 ảnh 1] [📷 ảnh 2]                                  │ │ ← lightbox
│ │                                                          │ │
│ │ 👍 Hữu ích (8) · Trả lời                              │ │ ← helpful + reply
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ [Tải thêm →]                                                │
└──────────────────────────────────────────────────────────────┘
```

### 7.10. Mobile-specific patterns

**Touch target:** mọi clickable ≥ 44×44px (đạt WCAG AA).

**Swipe gestures:**
- Swipe left tutor card → quick action drawer (Favorite, Compare, Hide)
- Swipe right calendar week → tuần kế / trước

**Bottom sheet thay sidebar:**
- Filter trên mobile dùng bottom sheet (Apple HIG pattern) thay sidebar overlay
- Concierge mobile = full-screen takeover thay slide-in

**Sticky bottom CTA bar:**
- Tutor profile mobile: "150k/h · [Đặt buổi]"
- Booking dialog mobile: CTA fixed bottom

**Pull to refresh:**
- Hub tab Tutors: pull → refresh search
- Calendar: pull → refresh booking list

### 7.11. Loading / Empty / Error states (đều có)

| State | Component | Pattern |
|---|---|---|
| Loading (initial) | Skeleton card 3-6 placeholder | pulse animate-pulse |
| Loading (pagination) | Spinner footer "Đang tải..." | inline |
| Empty (no result) | EmptyState illustration + CTA | "Chưa tìm thấy gia sư khớp · [Thử AI Concierge] [Đăng yêu cầu]" |
| Empty (no favorites) | Heart icon + "Lưu gia sư yêu thích" | CTA về tab Tutors |
| Empty (wallet new) | Wallet icon + "Nạp tiền lần đầu cashback 5%" | CTA [Nạp ngay] |
| Error (network) | Banner top "Mạng chậm, thử lại?" | retry button |
| Error (booking conflict) | Inline error đỏ trong dialog + suggest slot khác | |
| Error (payment fail) | Modal "Thanh toán thất bại — thử lại / dùng phương thức khác" | |
| Optimistic update fail | Toast destructive + rollback UI | |

**Skeleton component template** (V4 dùng chung cho mọi loading):

```tsx
<TutorCardSkeleton>  
  <Skeleton className="h-32 w-full rounded-xl" />     {/* photo */}
  <Skeleton className="mt-3 h-4 w-3/4" />              {/* name */}
  <Skeleton className="mt-1 h-3 w-1/2" />              {/* meta */}
  <Skeleton className="mt-2 h-3 w-2/3" />              {/* badge */}
  <Skeleton className="mt-3 h-8 w-full rounded-lg" /> {/* CTA */}
</TutorCardSkeleton>
```

### 7.12. Animations & motion

**Timing tokens:**
- Fast (instant feedback): 100-150ms — hover, button press
- Base (UI transition): 200ms — card hover, tab switch
- Slow (page transition): 300-400ms — modal open, drawer slide

**Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` (smooth out) cho mở modal/drawer; linear cho progress.

**Reduced motion respect:** Khi `prefers-reduced-motion: reduce` → tắt mọi transition trên 200ms, chỉ giữ opacity fade.

**Concrete animations V4 thêm:**
- Tutor card hover: lift + shadow + photo zoom (composite, 200ms)
- Concierge panel mở: slide từ right + fade backdrop (300ms)
- Match card stream-in: fade + slide up từng card 50ms stagger
- Calendar drag block: scale 1.05 + shadow elevated
- Compare floating cart: bounce in từ bottom 250ms
- Heatmap cell: fade hover color 100ms
- Streaming AI text: char-by-char + cursor blink

### 7.13. Accessibility (WCAG AA target)

| Aspect | Implementation |
|---|---|
| Keyboard navigation | Tab order logic, no `tabIndex=-1` trừ skip-link |
| Focus ring | `focus-visible:ring-2 ring-primary/40` mọi interactive |
| Skip link | "Bỏ qua đến nội dung chính" top-left khi tab |
| ARIA labels | Mọi icon-only button có `aria-label` |
| Color contrast | Text ≥ 4.5:1, large text ≥ 3:1; badge có icon song song không chỉ màu |
| Heading hierarchy | h1 → h2 → h3, không skip |
| Screen reader live region | `aria-live="polite"` cho chat stream, calendar update |
| Reduced motion | Detect + tắt transition |
| Form validation | inline error + `aria-describedby` link tới message |
| Modal trap focus | Radix Dialog đã handle |

### 7.14. Microcopy guidelines

**Tone:** thân thiện không hài, gọn, action-first, ngôi "mình/bạn" (cho student) và "thầy/cô" (cho tutor view).

**Examples:**

| Tình huống | Trước (V3) | Sau (V4) |
|---|---|---|
| Empty tutor list | "Không có gia sư." | "Chưa tìm thấy gia sư khớp · [Thử AI Concierge]" |
| Booking PENDING | "PENDING_TUTOR" | "Đang chờ gia sư xác nhận (thường < 30 phút)" |
| Pay button | "Thanh toán" | "Đặt ngay 180k" |
| Cancel | "Cancel" | "Huỷ buổi học" |
| Cancel free window | (chỉ button) | "Huỷ free trước 24h" |
| Error | "Error" | "Có lỗi xảy ra, thử lại?" |
| Slow mode | "Slow mode 5s" | "Đợi 5 giây để gửi tiếp" |
| AI loading | "Loading..." | "✨ Đang tìm gia sư phù hợp..." |
| Verify badge | "VERIFIED" | "Đã xác thực CCCD + bằng cấp" (tooltip) |
| Trust 100+ | "100+" | "100+ buổi đã hoàn thành" |

**Pricing display:**
- Always thousand separator: `180.000đ` not `180000`
- Use `đ` suffix not `VND` (thân thuộc hơn)
- Pack pricing: `1.300.000đ (-10%)` với strikethrough giá gốc bên cạnh

**Date/time:**
- "Hôm nay 19:00" cho ≤ 24h
- "T6 27/5 · 19:00" cho ≤ 7d
- "27/05 · 19:00" cho > 7d
- Relative for messages: "3 phút trước", "Hôm qua"

### 7.15. Discoverability & onboarding nudge

**First-time visitor `/tutoring`:**
- Show banner top: "✨ Mới: AI Concierge giúp tìm gia sư trong 1 phút" với CTA "Thử ngay"
- After dismiss → ẩn 7 ngày

**Tutor mới (chưa publish):**
- Banner: "Hoàn thành 3 bước để xuất hiện trên marketplace" + progress indicator

**Booking đầu tiên xong:**
- Toast success + modal soft "Đặt buổi lặp lại tuần tới?" → 1 click recurring

**Trial buổi xong:**
- Modal: "Buổi học thế nào? · [⭐ Rate] · [Đặt buổi tiếp][Mua pack 8 -10%]"

### 7.16. Design QA checklist (mỗi screen V4 ship)

- [ ] Light + Dark mode đẹp như nhau
- [ ] Mobile ≤ 375px không overflow
- [ ] Touch target ≥ 44px
- [ ] Keyboard nav tab-able đầy đủ
- [ ] Focus ring visible
- [ ] Empty state có CTA hợp lý
- [ ] Loading state có skeleton hoặc spinner
- [ ] Error state có recovery action
- [ ] Vietnamese diacritics render chuẩn (font fallback)
- [ ] Currency format đúng `180.000đ`
- [ ] Date format đúng theo guideline 7.14
- [ ] Microcopy theo tone guideline
- [ ] Animation respect `prefers-reduced-motion`
- [ ] Contrast ratio ≥ 4.5:1

---

## 8. Notifications expansion

V3 đã có Expo push qua BullMQ. V4 mở rộng:

- **Multi-channel**: push + email (Resend) + in-app inbox
- **Digest** — daily 8am summary (booking sắp tới + new match) cho student
- **Realtime** — Socket.IO push (gateway `apps/realtime`) cho:
  - "Tutor X vừa accept booking của bạn"
  - "Có gia sư mới match search lưu của bạn"
- **SMS fallback** (tuỳ chọn paid) — booking confirmation cho student không có push

Schema:
```sql
ALTER TABLE notification_log ADD COLUMN channel text DEFAULT 'push'
  CHECK (channel IN ('push', 'email', 'inapp', 'sms'));

CREATE TABLE user_notification_pref (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  push_enabled boolean DEFAULT true,
  email_enabled boolean DEFAULT true,
  daily_digest boolean DEFAULT true,
  digest_hour integer DEFAULT 8 CHECK (digest_hour BETWEEN 0 AND 23),
  -- Type-level mute
  muted_types text[] DEFAULT '{}'
);
```

---

## 9. Trust & safety improvements

- **AI flag suspicious DM** (V3 mention) — fully implement Mastra moderation tool: detect số tài khoản, link Zalo riêng, payment off-platform language
- **Tutor verification tier**:
  - Tier 1 (default): email verified
  - Tier 2 (KYC): CCCD + DOB match
  - Tier 3 (Pro): bằng cấp + chứng chỉ giảng dạy
  - Tier 4 (Trusted): 50+ booking + rating >= 4.5 + zero dispute
  - Badge UI khác nhau theo tier
- **Dispute flow** — student/tutor open dispute trong 7 ngày sau session → admin review → refund / partial / no
- **Background check** (manual) cho Tier 3+ — admin tool

---

## 10. Roadmap implementation

| Batch | Phase | Effort | Output |
|---|---|---|---|
| W1-W2 | T1 — AI Concierge | 5 ngày | Concierge panel + hybrid search + tool calls |
| W2-W3 | T2 — Frictionless booking | 4 ngày | Instant book + trial + reschedule + smart dialog |
| W3-W5 | T3 — Wallet + Packs + Promo | 5 ngày | Wallet ledger + pack purchase + installment + promo |
| W5-W7 | T4 — Calendar V2 + Group classes | 6 ngày | Calendar view + group class + recurring + iCal |
| W7-W8 | T5 — Trust polish | 4 ngày | Comparison + reviews v2 + favorites + alerts |

Total ~24 ngày net coding (4-5 weeks calendar với QA + iteration).

**Soft launch dần**:
- Sau T1 → ship internal beta, dogfood concierge
- Sau T2 → 10% rollout instant-book (opt-in tutors)
- Sau T3 → wallet GA cho mọi user
- Sau T4 → group classes opt-in
- Sau T5 → full V4 launch

---

## 11. Risks & mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| AI Concierge tốn token mỗi user → cost | High | Cache embedding + filter result, dùng Claude Haiku cho tool calls (rẻ hơn Sonnet) |
| Wallet ledger inconsistency (race) | Critical | DB transaction lock + ledger audit cron đối chiếu balance |
| Pack purchase abuse (mua → cancel buổi → refund hết) | Medium | Refund pack chỉ buổi chưa dùng + 10% admin fee |
| Group class no-show — N student rảnh | Medium | Min enrolled = 3 mới start, dưới ngưỡng → refund 100% |
| Recurring booking conflict tutor lịch đổi | Medium | Tutor edit availability → invalidate future recurring + notify cả 2 bên 7 ngày trước |
| Installment fail thanh toán | Medium | Auto-retry 3 lần / 3 ngày → escalate admin → mark DEFAULTED giữ booking đã học, freeze còn lại |
| iCal token leak | Low | Token rotate hàng quý + audit access log |

---

## 12. Success metrics

| Metric | V3 baseline | V4 target | Measure |
|---|---|---|---|
| TTV (search → confirmed) | 12 phút | 3 phút | analytics event funnel |
| Booking completion | 35% | 65% | (completed / created) |
| Repeat booking 30d | 18% | 45% | distinct (student, tutor) ≥ 2 |
| Concierge adoption | 0% | 40% | sessions with `tutoring_concierge_thread` |
| Wallet adoption | 0% | 70% | users with `user_wallet.balance > 0` |
| Group class enrollments | 0 | 100/tháng | enrollment count |
| Payment success rate | 85% | 95% | (captured / intent created) |
| Avg session rating | 4.2 | 4.5 | avg(rating) |
| Tutor responsiveness P50 | n/a | < 30 phút | tracked column |

---

## 13. Out of scope V4

Defer sang V5+:
- **Marketplace fee tier** (current 0% — V5 add 10-15% commission)
- **Tutor leaderboard / featured paid placement**
- **Mobile native app** (web responsive vẫn đủ)
- **Multi-language** (chỉ Vietnamese + tutor mặc định)
- **B2B / school accounts** (1 trường mua bulk pack)
- **Tutor team / agency** (multi-tutor 1 account)
- **API public 3rd party** integration
- **Pre-recorded course** (Udemy-style) — out of scope vĩnh viễn

---

## 14. Open questions cần user duyệt trước khi start

1. **Wallet provider topup** — chỉ VNPay/MoMo hay thêm bank transfer (qua QR VietQR)?
2. **Pack discount tiers** — V4 đề xuất 4 buổi: 5%, 8: 10%, 12: 15%. OK?
3. **Trial buổi giảm 50% hay free?** — Free risk no-show cao; giảm 50% giữ commitment.
4. **Concierge model** — Claude Haiku ($0.25/$1.25/M token) hay Sonnet ($3/$15/M)? Haiku đủ cho tool calling concierge.
5. **Group class min enrollment** — 3 hay 2? (2 thuận → khó mở rộng, 3 chắc chắn lớp nhóm)
6. **Recurring cancel policy** — student có thể skip 1 buổi giữa pack hay phải dùng hết?
7. **Refund timing** — wallet instant đẹp UX nhưng abuse risk; hold 24h cho admin review?
8. **Promo code visibility** — public landing page hay invite-only / referral?

---

## 15. Related docs

- `docs/plans/tutoring.md` — V1-V3 spec gốc (đã ship)
- `docs/plans/master.md` — overall roadmap
- `docs/plans/study-group-v2.md` — study group integration (auto-create khi booking confirmed)
- Memory: [[project-tutoring-v2-v3-shipped]], [[project-tutoring-marketplace-v1-shipped]]
