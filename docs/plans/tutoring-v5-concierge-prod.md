# Tutoring V5 — AI Concierge Production-Grade (2026-05-22)

**Mục tiêu**: Đưa AI Concierge từ MVP buggy → production-grade ngang Preply/Italki, hỗ trợ cả 2 chiều (student tìm tutor + tutor tìm student request), test kỹ với dataset realistic.

**Lý do làm**: V4 ship 1 chiều student → tutor có nhiều bug (role mismatch, no_match cứng, FTS miss khi không embed). Cần consolidate thành production-grade.

---

## Vấn đề hiện tại (sau V4)

1. **Role mismatch**: tutor gõ "tôi là gia sư cần tìm ứng viên" → bot recommend tutor cho họ (sai). Concierge mặc định student-mode, không detect tutor intent.
2. **Search 1 chiều**: chỉ search `tutor_profile`. Không có endpoint search `tutoring_request` cho tutor browse.
3. **Embedding sparse**: 1/6 tutor có `bio_embedding`. Cron `refresh-embeddings` chạy 03:00 daily → new tutor đợi ~24h mới semantic-searchable.
4. **Subject hierarchy bỏ qua**: query "tiếng Anh" → planner trả slug `english`, NHƯNG tutor có thể tag `english-ielts` / `english-toeic`. Search bỏ sót.
5. **Match-reason hallucinate**: khi RRF miss (fallback rating), match-reason LLM vẫn chạy với query không liên quan → hallucinate "phù hợp với yêu cầu".
6. **Dataset nhỏ**: 6 tutor, ~10 request. Không đủ để stress-test ranking, evaluate AI accuracy.
7. **0 automated test**: mỗi lần fix bug phải manual click. Không có regression suite.

---

## Plan

### Phase 1: Role Detection (planner + route) — ~45 min

Mỗi message qua planner thêm field `role: "student" | "tutor"`. Detection rule:

```
TUTOR intent (search REQUESTS):
- "tôi là gia sư / tôi là tutor / tôi đang dạy"
- "tìm học sinh / tìm ứng viên / tìm học viên"
- "có yêu cầu nào / có lead nào / có job nào"

STUDENT intent (search TUTORS) — default:
- "tôi muốn học / cần học / cần gia sư"
- "top gia sư X / có gia sư nào"
- mọi query khác không có tutor marker
```

Planner returns:

```json
{
  "role": "student" | "tutor",
  "action": "search" | "clarify",
  "searchTarget": "tutor" | "request",
  "filters": { subjectSlug, level, budgetMaxVnd, modality, keywords }
}
```

Route branches:

- `searchTarget=tutor` → `hybridSearchTutors()` (existing)
- `searchTarget=request` → `hybridSearchRequests()` (NEW)

Cache `role` trong `tutoring_concierge_thread.metadata` để giữ context.

**Files**:

- `apps/web/src/lib/tutoring/concierge-agent.ts` — planner prompt + schema
- `apps/web/src/app/api/tutoring/concierge/threads/[id]/messages/route.ts` — branch logic
- `apps/web/src/components/tutoring/concierge/concierge-panel.tsx` — render request card variant

---

### Phase 2: Request Search Engine — ~30 min

`apps/web/src/lib/tutoring/request-search.ts` (NEW):

```ts
hybridSearchRequests({ query, filters: { subjectSlug, level, budgetMinVnd, modality }, limit })
  → RequestSearchResult[]
```

Same RRF pattern as tutors:

- FTS qua `tutoring_request.search_vec` (cần add column + index)
- Vector qua `tutoring_request.description_embedding` (cần add column + backfill)
- Filter `status='OPEN'` cứng

Migration `0045_tutoring_v5_request_search.sql`:

```sql
ALTER TABLE tutoring_request ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX tutoring_request_search_vec_gin ON tutoring_request USING gin(search_vec);

ALTER TABLE tutoring_request ADD COLUMN description_embedding vector(1536);
```

Backfill embedding via existing `embedQuery` helper.

---

### Phase 3: AI Quality — ~30 min

**3a. Sync embed on publish**: `/api/tutors/[id]/publish` POST đã có. Add `embedQuery(bio)` synchronously → update `bio_embedding` + `bio_embedding_updated_at`. Cron chỉ refresh stale > 14 days.

**3b. Subject hierarchy expansion**:

- Build taxonomy helper `expandSubjectSlug(slug)`:
  - `english` → `['english', 'english-ielts', 'english-toeic']`
  - `cs-programming` → `['cs-programming', 'cs-algorithms']`
  - Others → `[slug]` (no expansion)
- hybrid-search filter: thay `ts.subject_slug = ${slug}` bằng `ts.subject_slug = ANY(${expanded})` (typed inArray).

**3c. Fail-soft match-reason**:

- Khi RRF returns 0 + fallback rating → SKIP match-reason LLM call entirely.
- Emit generic reason: `"Gia sư ${môn} — rating ${rating ?? 'mới'}"` (deterministic).
- Saves cost + avoids hallucination.

---

### Phase 4: Seed Realistic — ~60 min

`apps/web/scripts/seed-tutoring-v5.ts`:

**Tutors (200)**:

- Subjects: phân bố theo SUBJECT_BY_SLUG (Toán 25%, English 15%, Lý 10%, Hoá 8%, Văn 5%, IELTS 12%, TOEIC 8%, Lập trình 10%, others 7%).
- Levels: PRIMARY 20%, SECONDARY 25%, HIGH_SCHOOL 35%, UNIVERSITY 15%, ADULT 5%.
- Modality: ONLINE 40%, HYBRID 35%, OFFLINE_HN 12%, OFFLINE_HCM 13%.
- Rate: 80k–600k/h, normal-distributed quanh 200k.
- Rating: 70% có rating 3.5–5.0, 30% chưa có (new).
- Sessions: 0–500, log-normal.
- Instant book: 30% enabled.
- Trial: 60% enabled.
- Bio: realistic Vietnamese, 200–500 chars, mention level + style.
- Headline: 60–120 chars, kèm emoji.

**Requests (300)**:

- Subjects: cùng phân bố như tutor.
- Modality: ONLINE 50%, OFFLINE_HN 20%, OFFLINE_HCM 20%, HYBRID 10%.
- Budget: 100k–500k/h.
- Title + description realistic Vietnamese.
- Status: 80% OPEN, 15% MATCHED, 5% CLOSED.

**Classes (40)**:

- Mix subject + size 4–20.
- Schedule: ONE_OFF 20%, WEEKLY 60%, BIWEEKLY 20%.

**Source data**:

- Hard-coded name pool (Vietnamese 200+ unique names).
- Bio templates per subject (slot fill with concrete details).
- Avatar URL: dicebear avatars seeded by name.

**Embedding backfill**: script gọi `embedQuery(bio)` cho mỗi tutor + `embedQuery(description)` cho mỗi request. Batch 10 song song. Tổng ~500 embed calls = ~$0.02 with text-embedding-3-small.

Idempotent: check existing first, skip if seeded.

---

### Phase 5: AI Test Suite — ~45 min

`apps/web/src/lib/tutoring/__tests__/concierge.test.ts`:

**Fixtures** (`fixtures/concierge-cases.json`):

```json
[
  { "input": "toán 12", "expect": { "role": "student", "subject": "math", "level": "HIGH_SCHOOL", "minResults": 5 } },
  { "input": "tôi là gia sư toán cần tìm học sinh", "expect": { "role": "tutor", "searchTarget": "request", "subject": "math" } },
  { "input": "kém tiếng Anh cần gia sư", "expect": { "role": "student", "subject": "english", "minResults": 3 } },
  { "input": "ielts 6.5 online dưới 250k", "expect": { "role": "student", "subject": "english-ielts", "modality": "ONLINE", "budgetMax": 250000 } },
  { "input": "?", "expect": { "action": "clarify" } },
  { "input": "tôi cần học gì đó", "expect": { "action": "clarify" } },
  ...30 cases tổng
]
```

**Runner** (`scripts/eval-concierge.ts`):

- Load fixtures
- Gọi planner + search cho từng case
- Compare against `expect`
- Print accuracy table:
  ```
  Role detection:    28/30 (93%)
  Subject extraction: 27/30 (90%)
  Level inference:    25/28 (89%)
  Min results met:    26/26 (100%)
  ```
- Fail if accuracy < 85%.

CI integration: add to `package.json` script `eval:concierge`.

---

### Phase 6: Verify — ~15 min

- `pnpm tsc --noEmit` EXIT=0
- `pnpm eval:concierge` ≥ 85% accuracy
- Manual smoke test 5 case ở UI: student search, tutor search, ambiguous, edge, no_match
- DB query confirm seeded counts

---

## V5.1 + V5.2 (shipped 2026-05-22)

**V5.1 — Deep Q&A**:

- Action `tutor_detail` — "review về cô Mai", "lịch của thầy X", "giá của tutor số 2"
- Resolver fuzzy-match qua context thread (last shown tutor IDs) + global fallback
- TutorDetailBubble UI render reviews + stats + CTA

**V5.2 — Toàn diện**:

- FAQ knowledge base (`concierge-faq.ts`) với 15 entries cover: trial, refund, payment, pack discount, KYC, commission, payout, visibility, instant-book, cancel policy, support, platform overview, pricing, find good tutor, tutor cancel
- Action `faq` planner detect platform-level questions
- FaqBubble UI render Q + answer + optional CTA
- **globalReason** trong search response: deterministic giải thích vì sao N kết quả + sort rationale (KHÔNG hallucinate, không gọi LLM)

## Out of scope (V5.3+)

- Compare action ("so sánh 2 gia sư")
- Smarter availability lookup ("dạy cuối tuần?")
- Subject Q&A KB ("IELTS bao nhiêu band", "Toán 12 khó nhất phần nào")
- Inline filter pills UI trong chat
- Match score % visualization
- Push notification tutor khi có request mới khớp
- Saved-search cron alerts

---

## Estimate tổng

| Phase                    | Time       | Critical? |
| ------------------------ | ---------- | --------- |
| 1. Role detection        | 45m        | YES       |
| 2. Request search engine | 30m        | YES       |
| 3. AI quality fixes      | 30m        | YES       |
| 4. Seed realistic        | 60m        | YES       |
| 5. Test suite            | 45m        | YES       |
| 6. Verify                | 15m        | YES       |
| **Total**                | **~3h45m** |           |
