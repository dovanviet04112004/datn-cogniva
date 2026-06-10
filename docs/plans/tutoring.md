# Phase 21+ — Tutoring Marketplace

> Cho phép Cogniva kết nối **học sinh tìm gia sư** ↔ **gia sư đăng dịch vụ**. Tận dụng knowledge base + study group sẵn có để session 1-1 / 1-N hiệu quả hơn các platform khác (Toidi, Edumaster, Tutor.vn).

---

## 1. Vision & differentiator

**Vấn đề user hiện tại gặp:**
- Học sinh: tìm gia sư qua nhóm Facebook / Zalo, không có hồ sơ chuẩn, dễ gặp scam, không có công cụ học chung sau khi match.
- Gia sư: đăng vào group nhỏ lẻ, không reach được nhiều học sinh, không có công cụ chuyên môn để giảng (chỉ Zoom/Meet).

**Differentiator Cogniva:**
1. **Tích hợp study tool** — match xong, tự tạo study group (Phase 20) cho cặp gia sư-học sinh, có voice channel + whiteboard + AI Tutor + flashcards.
2. **AI matching** — không chỉ filter tag, dùng embedding để match yêu cầu học sinh ↔ chuyên môn gia sư (qua bio + subjects).
3. **Verified knowledge** — gia sư upload tài liệu mẫu, AI quiz đánh giá → badge "verified" trên môn đó.
4. **Session note tự động** — recording voice channel (Phase 20 V3) → transcript + summary auto save sau buổi học.

---

## 2. User stories

### Học sinh (Student)
1. **Tìm gia sư**: filter môn + lớp + budget + lịch + online/offline → list profile match.
2. **Đăng yêu cầu**: nếu chưa thấy ai phù hợp → đăng post mô tả nhu cầu → gia sư đề xuất ngược.
3. **Liên hệ**: chat DM trước khi book → confirm price + schedule.
4. **Book session**: pick time slot từ availability của gia sư → 24h trước thì gia sư confirm.
5. **Học**: vào study group dedicated (auto-create) — voice + whiteboard + AI tutor.
6. **Review**: sau session, rate 1-5 sao + comment.
7. **Lịch sử**: xem các session đã học, transcript, flashcard generate.

### Gia sư (Tutor)
1. **Tạo hồ sơ**: bio, ảnh, môn dạy, level, giá, availability matrix, kinh nghiệm.
2. **Verify chuyên môn**: upload tài liệu giảng + làm AI quiz để được badge.
3. **Browse requests**: list student requests phù hợp môn + lịch.
4. **Đề xuất**: respond request với offer (giá, lịch trống).
5. **Quản lý lịch**: confirmed sessions calendar, sync iCal (V2).
6. **Earnings dashboard** (V3): tổng thu + bị giữ + đã rút.

### Admin (Cogniva ops)
- Verify gia sư (CCCD + bằng cấp), mod review feedback, dispute resolution, payout (V3).

---

## 3. Scope theo phase

### V1 — Listings + DM (SHIPPED 2026-05-15)
- ✅ Tutor profile CRUD (subjects, level, hourly rate, bio, hourly availability)
- ✅ Student request CRUD
- ✅ Search/filter cả 2 chiều
- ✅ DM giữa student ↔ tutor (reuse DM Phase 20 V2)
- ✅ Manual book — chat thoả thuận

### V2 — Booking + Sessions (SHIPPED 2026-05-15)
- ✅ Booking system: slot + confirm + cancel (24h policy)
- ✅ Auto-create study group (TEXT + VOICE + FORUM) khi confirmed
- ✅ Calendar API + upcoming bookings trên mine tab
- ✅ Reviews + ratings sau session (5-star + comment)
- ✅ AI matching (lazy embed bio + request, cosine via pgvector `<=>`)

### V3 — Verification + Payment (SHIPPED 2026-05-15)
- ✅ KYC upload (CCCD + bằng cấp) + admin review queue
- ✅ Subject verification: AI generate quiz 10 câu MCQ → tutor làm bài qua
     quiz attempt UI hiện có → score auto sync vào `tutor_subject_verify_quiz`
     + cập nhật `tutor_subject.verifiedAt` nếu ≥ passThreshold
- ✅ Payment integration full code-ready:
     - **STUB** (dev): auto-capture local, không gọi API ngoài
     - **VNPAY**: pay URL (HMAC-SHA512) + IPN webhook + refund API call.
       Env cần: `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL`,
       `VNPAY_PAY_URL`, `VNPAY_REFUND_URL`. Nạp env → switch
       `PAYMENT_PROVIDER=VNPAY` để live.
     - **MoMo**: create payment qua HMAC-SHA256 + IPN webhook + refund API.
       Env: `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`,
       `MOMO_CREATE_URL`, `MOMO_REFUND_URL`, `MOMO_RETURN_URL`, `MOMO_IPN_URL`.
- ✅ Refund: cancel booking gọi `refundPayment()` — STUB flag local,
     VNPay/MoMo gọi API refund thật. Refund fail → giữ status CAPTURED,
     admin xử lý manual.
- ✅ Earning dashboard + payout request (admin manual approve PAID)
- ✅ BullMQ cron `tutoring-auto-complete` mỗi giờ — auto mark COMPLETED
     booking có `endAt + 1h < NOW()` + set escrow release.

### V4+ — Scale (optional)
- Group classes (1 tutor → N student)
- Marketplace fee tier
- Tutor leaderboard / featured
- Mobile app push (Phase M7 đã có)
- API public cho 3rd-party tích hợp

---

## 4. Schema design

### 4.1. `tutor_profile`
1 user có TỐI ĐA 1 tutor profile. Tạo lazy khi user click "Trở thành gia sư".

```ts
export const tutorProfile = pgTable('tutor_profile', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  /** Headline ngắn — vd "Gia sư Toán cao cấp 5 năm kinh nghiệm". */
  headline: text('headline').notNull(),
  /** Bio chi tiết Markdown, 200-2000 chars. */
  bio: text('bio').notNull(),
  /** Giá VND/giờ (mặc định), có thể override trong availability slot. */
  hourlyRateVnd: integer('hourly_rate_vnd').notNull(),
  /** Online | OFFLINE_HN | OFFLINE_HCM | HYBRID — V1 đơn giản. */
  modality: text('modality').notNull().default('ONLINE'),
  /** Avatar override (nếu khác user.image). */
  avatarUrl: text('avatar_url'),
  /** Banner cover. */
  bannerUrl: text('banner_url'),
  /** Số session đã hoàn thành (cached, update bằng trigger hoặc cron). */
  sessionsCompleted: integer('sessions_completed').notNull().default(0),
  /** Rating trung bình 1-5 (cached). */
  ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
  ratingCount: integer('rating_count').notNull().default(0),
  /** Verified badge: NONE | KYC_PENDING | KYC_VERIFIED. */
  verificationStatus: text('verification_status').notNull().default('NONE'),
  /** Embedding của bio + subjects — dùng cho AI matching. */
  bioEmbedding: vector('bio_embedding', 1024),
  /** Trạng thái listing: DRAFT | PUBLISHED | PAUSED. */
  status: text('status').notNull().default('DRAFT'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

### 4.2. `tutor_subject`
Nhiều môn / 1 tutor. Cho phép tutor verify từng môn riêng.

```ts
export const tutorSubject = pgTable('tutor_subject', {
  id: text('id').primaryKey().$defaultFn(createId),
  tutorId: text('tutor_id').notNull().references(() => tutorProfile.id, { onDelete: 'cascade' }),
  /** Slug standard: 'math', 'physics', 'english', 'cs-basics', 'cs-ds-algo', ... */
  subjectSlug: text('subject_slug').notNull(),
  /** PRIMARY | SECONDARY | HIGH_SCHOOL | UNIVERSITY | ADULT. */
  level: text('level').notNull(),
  /** Verified bởi AI quiz V3 — NULL = chưa verify. */
  verifiedAt: timestamp('verified_at'),
  /** Score quiz nếu đã làm (0-100). */
  verifyScore: integer('verify_score'),
}, (t) => ({
  uniq: uniqueIndex('tutor_subject_uniq').on(t.tutorId, t.subjectSlug, t.level),
}));
```

### 4.3. `tutor_availability`
Recurring weekly slots. V2 sẽ override theo ngày cụ thể.

```ts
export const tutorAvailability = pgTable('tutor_availability', {
  id: text('id').primaryKey().$defaultFn(createId),
  tutorId: text('tutor_id').notNull().references(() => tutorProfile.id, { onDelete: 'cascade' }),
  /** 0=Sunday, 1=Monday, ..., 6=Saturday. */
  dayOfWeek: integer('day_of_week').notNull(),
  /** "HH:MM" 24h format. */
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  /** Time zone — default 'Asia/Ho_Chi_Minh'. */
  timezone: text('timezone').notNull().default('Asia/Ho_Chi_Minh'),
}, (t) => ({
  tutorIdx: index('tutor_availability_tutor_idx').on(t.tutorId),
}));
```

### 4.4. `tutor_request`
Student post tìm gia sư. Public, các tutor browse + apply.

```ts
export const tutorRequest = pgTable('tutor_request', {
  id: text('id').primaryKey().$defaultFn(createId),
  studentId: text('student_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  subjectSlug: text('subject_slug').notNull(),
  level: text('level').notNull(),
  /** Budget VND/giờ tối đa. */
  budgetVnd: integer('budget_vnd'),
  modality: text('modality').notNull().default('ONLINE'),
  /** ASAP | THIS_WEEK | THIS_MONTH | FLEXIBLE. */
  urgency: text('urgency').notNull().default('FLEXIBLE'),
  /** OPEN | MATCHED | CLOSED. */
  status: text('status').notNull().default('OPEN'),
  /** Embedding description — match với tutor bioEmbedding. */
  embedding: vector('embedding', 1024),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
}, (t) => ({
  subjectIdx: index('tutor_request_subject_idx').on(t.subjectSlug, t.level, t.status),
  studentIdx: index('tutor_request_student_idx').on(t.studentId, t.createdAt),
}));
```

### 4.5. `tutor_application`
Tutor apply vào request của student.

```ts
export const tutorApplication = pgTable('tutor_application', {
  id: text('id').primaryKey().$defaultFn(createId),
  requestId: text('request_id').notNull().references(() => tutorRequest.id, { onDelete: 'cascade' }),
  tutorId: text('tutor_id').notNull().references(() => tutorProfile.id, { onDelete: 'cascade' }),
  /** Lời chào ngắn + đề xuất giá. */
  message: text('message').notNull(),
  proposedRateVnd: integer('proposed_rate_vnd').notNull(),
  /** PENDING | ACCEPTED | REJECTED | WITHDRAWN. */
  status: text('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('tutor_application_uniq').on(t.requestId, t.tutorId),
}));
```

### 4.6. `tutoring_booking` (V2)

```ts
export const tutoringBooking = pgTable('tutoring_booking', {
  id: text('id').primaryKey().$defaultFn(createId),
  tutorId: text('tutor_id').notNull().references(() => tutorProfile.id, { onDelete: 'restrict' }),
  studentId: text('student_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** Link tới study group auto-create khi confirmed. */
  studyGroupId: text('study_group_id').references(() => studyGroup.id, { onDelete: 'set null' }),
  subjectSlug: text('subject_slug').notNull(),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
  rateVnd: integer('rate_vnd').notNull(),
  /** PENDING_TUTOR | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED. */
  status: text('status').notNull().default('PENDING_TUTOR'),
  /** Notes tutor để lại sau buổi học. */
  sessionNotes: text('session_notes'),
  /** Recording ID nếu có (Phase 20 V3 voice recording). */
  recordingId: text('recording_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at'),
  cancelledBy: text('cancelled_by'),
}, (t) => ({
  tutorTimeIdx: index('tutoring_booking_tutor_time_idx').on(t.tutorId, t.startAt),
  studentTimeIdx: index('tutoring_booking_student_time_idx').on(t.studentId, t.startAt),
}));
```

### 4.7. `tutor_review` (V2)
```ts
export const tutorReview = pgTable('tutor_review', {
  id: text('id').primaryKey().$defaultFn(createId),
  bookingId: text('booking_id').notNull().unique().references(() => tutoringBooking.id, { onDelete: 'cascade' }),
  reviewerId: text('reviewer_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  tutorId: text('tutor_id').notNull().references(() => tutorProfile.id, { onDelete: 'cascade' }),
  /** 1-5. */
  rating: integer('rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

---

## 5. API design

### V1 endpoints
```
# Tutor profile
GET    /api/tutors                       — list (filter subject/level/budget/modality)
POST   /api/tutors                       — create profile (lazy upgrade user)
GET    /api/tutors/[id]                  — detail profile
PATCH  /api/tutors/[id]                  — update (chỉ owner)
DELETE /api/tutors/[id]                  — delete profile
POST   /api/tutors/[id]/publish          — DRAFT → PUBLISHED

# Subjects
POST   /api/tutors/[id]/subjects         — add subject
DELETE /api/tutors/[id]/subjects/[sid]   — remove

# Availability
PUT    /api/tutors/[id]/availability     — bulk replace

# Student requests
GET    /api/tutoring/requests            — list (filter same)
POST   /api/tutoring/requests            — create
PATCH  /api/tutoring/requests/[id]       — update/close
GET    /api/tutoring/requests/[id]       — detail + applications

# Applications
POST   /api/tutoring/requests/[id]/apply    — tutor apply
GET    /api/tutoring/requests/[id]/applications  — student xem ai apply
POST   /api/tutoring/applications/[id]/accept    — student chọn
POST   /api/tutoring/applications/[id]/reject

# DM trigger (reuse Phase 20 V2)
POST   /api/dm  body { peerUserId: tutor.userId }
```

### V2 endpoints
```
POST   /api/tutoring/bookings            — student tạo booking
POST   /api/tutoring/bookings/[id]/confirm   — tutor confirm
POST   /api/tutoring/bookings/[id]/cancel
POST   /api/tutoring/bookings/[id]/complete  — auto khi endAt < now
POST   /api/tutoring/bookings/[id]/review    — student review
GET    /api/tutoring/calendar/me         — calendar 7 ngày tới (tutor)
GET    /api/tutoring/matches             — AI-suggested matches (vector cosine)
```

### V3 endpoints
```
POST   /api/tutors/[id]/kyc              — upload CCCD/bằng cấp
POST   /api/tutors/[id]/subjects/[sid]/verify-quiz  — generate AI quiz
POST   /api/tutoring/payments/intent     — tạo VNPay intent
POST   /api/webhooks/vnpay               — payment confirm webhook
POST   /api/tutoring/payments/payout     — tutor request rút tiền
```

---

## 6. UI flow

### V1 pages
- `/tutors` — browse tutors (grid card)
- `/tutors/[id]` — profile detail + "Liên hệ" button → DM
- `/tutors/become` — upgrade flow (3 steps: bio → subjects → availability → preview → publish)
- `/tutors/me` — tutor dashboard (my listings + applications + DM)
- `/tutoring` — browse student requests
- `/tutoring/requests/new` — post yêu cầu
- `/tutoring/requests/[id]` — detail + apply (tutor) / list applications (student)

### Sidebar
Thêm section "SOCIAL → Tutoring" với 2 link:
- "Tìm gia sư" → `/tutors`
- "Yêu cầu học" → `/tutoring`

Nếu user `tutor_profile.status='PUBLISHED'` → thêm "Tutor dashboard" → `/tutors/me`.

---

## 7. Integration với feature hiện có

### 7.1. DM (Phase 20 V2)
Reuse hoàn toàn. Student bấm "Liên hệ" trên tutor profile → POST `/api/dm { peerUserId }` → navigate `/messages/[threadId]`. Không cần endpoint mới.

### 7.2. Study group (Phase 20 V1-V3)
Khi booking confirmed:
- Auto-create `study_group` với 2 member (tutor=OWNER, student=MEMBER)
- 1 TEXT channel `chung` + 1 VOICE channel `phòng-học` + 1 FORUM `q-a`
- Khi booking complete → group **không xoá** (lưu lại để học sinh xem lại transcript + flashcards)
- Recording voice channel (V3) tự attach vào booking qua `tutoringBooking.recordingId`

### 7.3. Documents + AI Tutor (Phase 1-2)
Tutor có thể share document Cogniva với student trong group dedicated → AI Tutor chat scope theo workspace của tutor → student hỏi đáp về tài liệu giảng.

### 7.4. Flashcards (Phase 6)
Khi recording session done → flashcard auto-gen (10 cards) → share cho student → ôn lại.

### 7.5. Notifications (Phase M7)
Events push:
- Tutor: `tutoring/application-received`, `booking/confirmed`, `booking/cancelled`, `booking/reminder-30min`
- Student: `tutoring/application-accepted`, `booking/confirmed`, `booking/reminder-30min`, `review/request`

### 7.6. Audit log
- `tutor.kyc.submitted/verified/rejected`
- `tutoring.booking.created/confirmed/cancelled/completed`
- `tutoring.review.submitted`
- `tutoring.payment.processed/refunded`

### 7.7. GDPR
- User xoá account → `tutor_profile` cascade (xoá hết listing + subjects + availability)
- `tutoring_booking` của user khác: anonymize student_id → 'deleted-user', giữ booking để tutor báo cáo tax

### 7.8. AI matching (V2)
- Embedding tutor.bio + tutor_subject (concat) → tutor.bioEmbedding
- Embedding tutor_request.description → request.embedding
- Match score = cosine(request, tutor.bioEmbedding) × subject filter score
- Re-rank top 20 → return top 5

---

## 8. Risks

### 8.1. Functional
| Risk | Mitigation |
|---|---|
| Gia sư fake / không thật | KYC bắt buộc trước khi publish (V3); V1 chỉ verified email |
| Student book rồi no-show | Cancellation policy 24h, V2 charge deposit 10% non-refundable |
| Double-booking 1 tutor 2 slot trùng | DB unique constraint (tutorId, startAt, endAt) + transaction lock khi create booking |
| Rate manipulation (fake review) | V3: chỉ student có booking COMPLETED mới review được; rate limit 1/booking |

### 8.2. Abuse
| Risk | Mitigation |
|---|---|
| Spam request (1 student post 100 cái) | Rate limit 5/ngày/user |
| Tutor harass student qua DM | Block + report flow (reuse Phase 20 V2 group ban patterns) |
| Off-platform payment để né phí | Term of service ban; AI flag DM có số tài khoản (V3) |

### 8.3. Legal
| Risk | Mitigation |
|---|---|
| Vietnam tax / hoá đơn cho tutor | V3: tutor tự kê khai, Cogniva chỉ cấp invoice tổng cho rút tiền |
| Underage student (<18) | Có sẵn `parental_consent_status` flow (Phase 1); cần parent approve trước booking |
| Tutor không có chứng chỉ giảng dạy | V1 chỉ display "self-claimed", V3 verify bằng cấp upload |
| GDPR/personal data student-tutor share | Mã hoá DM at-rest, audit access |

### 8.4. Scale
| Risk | Trigger | Mitigation |
|---|---|---|
| `tutor_request` table > 1M rows | T2 growth | Partition by `created_at` month |
| AI matching latency > 2s | > 10K tutor | Pre-compute matches mỗi 6h qua BullMQ cron |
| KYC review backlog | > 100 tutor/ngày | Hire ops, hoặc fully automated với Cognivision (V4) |

---

## 9. Out of scope

### V1+ skip
- **Group classes** (1 tutor → N student cùng lúc) — V4
- **Recurring booking** (mỗi tuần thứ 3 lúc 7pm) — V2 chỉ single slot
- **Marketplace fee/commission** — V3 setup, V1-V2 free
- **Multi-currency** — chỉ VND
- **Video CV của tutor** — V3, MP4 upload R2
- **Refer-a-friend** — V4 growth feature
- **Tutor có thể tạo course** (Udemy-style pre-recorded) — out of scope, dùng product khác

### Hoàn toàn out of scope
- LMS course delivery — đã có Phase 20 V3 (LTI hoãn)
- Live streaming 1-N — không, focus 1-1
- Online exam proctoring qua AI — đã có Phase 16, reuse cho booking trial test

---

## 10. Migration order

Khi start Phase 21:

1. **Batch A** (~2 ngày) — Schema + base CRUD
   - Migration `0021_tutor_profile.sql`, `0022_tutor_subject.sql`, `0023_tutor_availability.sql`, `0024_tutor_request_application.sql`
   - API endpoints V1 (tutor + request + application)
2. **Batch B** (~2 ngày) — UI listings
   - `/tutors` browse, `/tutors/[id]` detail, `/tutors/become` flow
   - `/tutoring` browse requests, `/tutoring/requests/new`
3. **Batch C** (~1 ngày) — Apply + DM wire
   - Apply flow tutor → student
   - "Liên hệ" button → DM
4. **Batch D** (~2-3 ngày) — V2 Booking
   - Migration `0025_tutoring_booking.sql`, `0026_tutor_review.sql`
   - Calendar API + UI
   - Auto-create study group on confirm
5. **Batch E** (~2 ngày) — AI matching V2
   - Embed bio + request, cron compute matches, `/api/tutoring/matches`
6. **Batch F** (V3) — KYC + Payment
   - Document upload + admin review queue
   - VNPay integration

V1 release sau Batch C (~5 ngày), V2 release sau Batch E (~10 ngày), V3 cần thêm 7-10 ngày.

---

## 11. Open questions

1. **Free hay phí?**
   - V1-V2: free hoàn toàn → grow user → V3 launch fee.
   - Hoặc subscription model cho tutor ($3/tháng để publish).
2. **Tutor có cần là user của Cogniva trước không?**
   - Đề xuất: bắt buộc — tutor profile là upgrade của user account. Bảo mật + reuse auth.
3. **Voice channel session có pay-per-minute không?**
   - V1: per-booking flat rate.
   - V4 có thể thêm "phòng tư vấn 15 phút free" để tutor pitch.
4. **Subject taxonomy chuẩn nào?**
   - Đề xuất dùng curriculum VN: K-12 chương trình mới + đại học theo Bộ GD&ĐT khung môn (~80 môn).
5. **Conflict với study group hiện có?**
   - Tutor có thể tạo group riêng (Phase 20) hoặc dùng booking group (auto-create). Phải clarify UX.

---

## 12. Success metrics

- **V1**: 50 tutor profile published, 100 student request posted trong 30 ngày sau release.
- **V2**: 200 booking completed, average rating > 4.0, no-show rate < 10%.
- **V3**: ≥ 30% booking via payment integration (chấp nhận trả qua app), repeat booking rate > 25%.

---

## Changelog — V5 quản lý đơn (2026-05-30)

Bổ sung lớp QUẢN LÝ booking/request còn thiếu (lifecycle + API đã có sẵn từ trước):

- **Trang "Đơn của tôi"** (`/tutoring?tab=orders`) — component `bookings-manager.tsx`: list booking lọc theo nhóm trạng thái (Chờ xác nhận · Sắp/đang học · Đã xong · Đã huỷ) + đếm số. Toggle "Tôi học / Tôi dạy" khi user vừa là học viên vừa là gia sư. Fetch `GET /api/tutoring/bookings?role=`.
- **API bookings** mở rộng: join thêm user học viên (alias) → trả `studentName/studentImage` để tutor view thấy ai đặt. Thêm `isTrial`.
- **Dashboard gia sư** (`/tutors/me`) — thay redirect cũ bằng trang thật: header hồ sơ + trạng thái publish/KYC, stats (rating/buổi/xác thực), **Đơn tôi dạy** (BookingsManager role=tutor), **Thu nhập** (EarningsCard), **Yêu cầu đã apply**.
- **Đóng yêu cầu**: nút `close-request-button.tsx` trên `/tutoring/requests/[id]` cho chủ yêu cầu (PATCH status=CLOSED).
- Accept/Reject application: ĐÃ có sẵn trong `applications-list.tsx` (PATCH `/api/tutoring/applications/[id]` → accept tự reject app khác + request MATCHED).

Còn thiếu (chưa làm đợt này): reschedule UI, wire VNPay thật, auto-trigger IN_PROGRESS.

## Changelog — V5.1 gom trùng + panel inline (2026-05-30)

- **Gom dashboard**: bỏ trang `/tutors/me` riêng (trùng tab "Tổng quan") → redirect `?tab=mine`. Header "Bảng gia sư" trỏ thẳng `?tab=mine`. MineTab bỏ list "buổi sắp tới" trùng → chỉ còn 1 card link sang "Đơn học". Kết quả: 1 hub cá nhân (Tổng quan) + 1 nơi xem đơn (Đơn học).
- **Đổi tên tab** cho hết lặp "của tôi": "Đơn của tôi"→"Đơn học", "Của tôi"→"Tổng quan".
- **Panel inline** (như workspace): `booking-detail-drawer.tsx` — bấm đơn ở list mở Drawer trượt (info + phòng học + ghi chú + nút xác nhận/huỷ/hoàn thành tái dùng `BookingActions`), không nhảy trang. `BookingActions` thêm `onDone` để drawer/list tự refetch. GET booking thêm `studentName/studentImage`. Link "Mở trang đầy đủ" cho thanh toán/đánh giá.
- Header gọn: Ví/Lịch học → nút icon.

## Changelog — V5.2 gỡ trang đầy đủ, dồn vào modal (2026-05-31)

- **Booking modal tự đủ**: nhồi thanh toán (BookingPaymentBox) + đánh giá (BookingReviewForm) vào modal; GET booking trả thêm `payment`. Bỏ link "Trang đầy đủ".
- **Request modal**: bỏ link "Trang đầy đủ" (vốn đã đủ chức năng).
- **2 trang detail → redirect**: `/tutoring/bookings/[id]` → `/tutoring?tab=orders&booking=<id>` (giữ query thanh toán), `/tutoring/requests/[id]` → `/tutoring?tab=requests&request=<id>`. KHÔNG xoá file vì deep-link cứng (return thanh toán, iCal, calendar, concierge, tạo booking/yêu cầu) — redirect để mọi link cũ tự chảy vào modal, không 404.
- **Auto-open**: BookingsManager đọc `?booking=` (one-shot ref) tự mở modal; `RequestAutoOpen` đọc `?request=` mount trong RequestsTab.
- ⚠️ Cần test thật luồng thanh toán return (STUB/VNPay) vì giờ chảy qua modal thay vì page.

## Changelog — V5.3 chat dock + thông báo (2026-05-31)

- **Bỏ nút "Bảng gia sư"** ở header /tutoring (trùng tab "Tổng quan" ?tab=mine).
- **ChatDock** (`components/dm/chat-dock.tsx`): cửa sổ chat nổi góc dưới phải kiểu Facebook. `ChatDockProvider` mount ở (app)/layout → state giữ qua chuyển trang + localStorage (qua reload). `useChatDock().openChat({threadId, peer})`. Mỗi cửa sổ: thu nhỏ (—) thành pill, đóng (X), tối đa 3. Tái dùng `DmChat` (thêm props `compact/onClose/onMinimize`). ContactTutorButton giờ mở dock thay vì nhảy /messages.
- **Thông báo đơn hàng**: emit `notificationLog` ở confirm (→ học viên), complete (→ học viên đánh giá), cancel (→ bên còn lại). Bell deep-link `booking-*` → `/tutoring?tab=orders&booking=<id>` (mở modal đơn).
- **Thông báo tin nhắn**: dm POST emit `notificationLog` type `dm-message` (GỘP 1 dòng/thread, xoá unread cũ rồi insert). Bell click `dm-message` → mở ChatDock với peer = người gửi. Icon riêng cho dm/booking trong chuông.

## Changelog — V5.3.1 realtime notifications (2026-05-31)

- Helper `lib/notifications/notify.ts#createNotification`: insert notificationLog + `triggerEvent(presence-user-{uid}, 'notification:new')`.
- Booking confirm/complete/cancel + DM message: chuyển sang dùng createNotification → bắn realtime.
- NotificationBell nhận `userId`, subscribe `presence-user-{userId}` event `notification:new` → refetch NGAY (poll 60s chỉ còn là fallback). Auth route đã cho phép chính chủ sub kênh presence-user (Phase M7).

## Changelog — V5.4 group notif + voice persist (2026-05-31)

- **Group mention realtime**: `mention-notify.ts` bắn `triggerEvent(presence-user-{uid}, 'notification:new')` sau insert → chuông cập nhật ngay.
- **Group join notif**: `/api/groups/join` → createNotification cho chủ nhóm ('group-join'); bell deep-link → `/groups/{id}`.
- **Voice giữ phiên khi chuyển trang (Discord-style)**:
  - `VoiceSessionProvider` (mount ở (app)/layout) GIỮ LiveKit connection — không unmount khi đổi route.
  - `voice-room-ui.tsx`: tách UI bên trong LiveKitRoom. `voice-channel.tsx`: wrapper mỏng, khi active render host div để provider **portal** UI đầy đủ vào (giao diện như cũ).
  - Off-page: VoiceRoomUI render ẩn (display:none — audio KHÔNG rớt) + **thanh nổi** góc dưới trái (mic toggle / quay lại kênh / rời). 1 instance VoiceRoomUI → RoomAudioRenderer không nhân đôi.
  - ⚠️ Cần test live (2 browser + mic) — LiveKit không kiểm tự động được.

## Changelog — V5.5 voice PiP kiểu Google Meet (2026-05-31)

- `lib/use-document-pip.tsx`: hook mở **Document Picture-in-Picture** (Chromium) — cửa sổ nổi luôn-trên-cùng, ra NGOÀI tab/trình duyệt/app khác. Copy stylesheet + class dark-mode sang cửa sổ PiP.
- `voice-pip-view.tsx`: nội dung PiP — video (camera/screen) hoặc placeholder + control bar (mic/cam/quay lại app/rời).
- VoiceSessionLayer: portal VoicePiPView vào `pipWindow.document.body` (vẫn trong LiveKitRoom tree → hook LiveKit chạy). Nút PiP ở thanh nổi + header phòng. Feature-detect: không hỗ trợ → ẩn nút, dùng thanh nổi trong tab.
