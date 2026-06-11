# Library — Kho Tài Liệu AI-Native (2026-05-22)

> **Philosophy**: Đảo ngược paradigm Studocu (2010s filter-browse-download) → AI-first goal-driven discovery + atom-level slicing + outcome-verified quality. Library KHÔNG phải kho file dump, mà là **engine học tập thông minh** kết nối content + workspace + AI + outcome.

---

## Tagline

> **"Tell me your goal, get a learning plan with real materials — not just a Google Drive of PDFs."**

---

## 6 Innovation Pillars (đột phá so với Studocu/VnDoc/Course Hero)

### 🎯 Pillar 1 — Goal-Driven Discovery (không filter)

User gõ MỤC TIÊU, AI tự build study path. Filter chỉ là backup cho power user.

```
User: "Ôn thi tốt nghiệp Toán THPT 2025 trong 4 tuần, hiện 7.5đ mục tiêu 9đ"

AI Concierge phân tích:
  goal:           graduation_exam
  subject:        math
  level:          HIGH_SCHOOL
  deadline:       2025-06-15 (4 tuần)
  current_score:  7.5 → target_score: 9.0
  gap_atoms:      AI infer 12 atoms cần master (từ exam blueprint)

Output study plan:
  Tuần 1 — Đạo hàm + ứng dụng (3 atoms gap)
    Lý thuyết: Doc A (tr.12-30) + Doc B (tr.5-20)
    Bài tập:   Doc C (50 câu trắc nghiệm)
    Đề mock:   1 đề thử cuối tuần
  Tuần 2 — Tích phân (4 atoms gap)
  Tuần 3 — Hình học không gian Oxyz (3 atoms gap)
  Tuần 4 — Đề thi thử full (3 đề mock) + revision

[1-click "Tạo workspace ôn thi này"]
→ Auto-create workspace với 12 doc + 80 flashcard FSRS + 3 quiz + atom map
→ User ready học ngay, không touch filter một lần.
```

### 🔍 Pillar 2 — Cross-Doc Semantic Search

Search vào nội dung TỪNG CHUNK của TẤT CẢ docs, không phải metadata cấp doc.

```
User: "Đoạn nào nói về định lý Vi-et?"

Studocu/VnDoc: trả docs có title chứa "Vi-et" (~5 results, kém)

Cogniva:
  → Vector search ON library_doc_chunk (mọi page của mọi doc)
  → Top 10 chunks:
    Doc A, p.12: "Theo định lý Vi-et, nếu x₁, x₂ là 2 nghiệm..."
    Doc B, p.7:  "Áp dụng Vi-et cho phương trình bậc 2..."
    Doc C, p.23: "Định lý Vi-et và mở rộng cho bậc 3..."
  → Click chunk → mở PDF.js scroll thẳng tới trang đó, đoạn highlighted vàng
```

### 🧩 Pillar 3 — Atom-Level Slicing (Skip Đã Biết)

Doc 200 trang → AI extract atoms → user chỉ học atoms chưa nắm. **Cộng hưởng với atom-centric pivot của Cogniva.**

```
Mở doc "Toán THPT đầy đủ" (200 trang, 80 atoms)

Auto-check vs user's mastered atoms (từ workspace history):
  ☑ Đạo hàm hàm bậc 1   (đã master qua quiz) → skip
  ☑ Đạo hàm hàm bậc 2   (đã master) → skip
  ☐ Đạo hàm hàm hợp     (chưa master) → highlight
  ☐ Đạo hàm cấp cao     (chưa master) → highlight
  ☑ Tích phân cơ bản    (đã master) → skip
  ☐ Tích phân từng phần (chưa master) → highlight
  ...

Mode "Smart reading" (toggle ON default):
  Hide trang chứa atoms đã biết
  Show 28/200 trang relevant
  Time saved: ~85% vs đọc cả doc
```

### 📷 Pillar 4 — Reverse Search by Problem

Upload đề bí / chụp ảnh câu hỏi → tìm doc giải tương tự.

```
User: chụp đề Toán THPT câu khó
       hoặc upload PDF đề thi mock

Pipeline:
  1. OCR + GPT vision parse câu hỏi
  2. Extract atom + difficulty + concept
  3. Vector search library_doc_atom có atom tương tự
  4. Vector search library_doc_chunk có lời giải mẫu

Output:
  Câu này thuộc topic: "tích phân từng phần"
  Lý thuyết:         Doc A, tr.45 — "Phương pháp tích phân từng phần"
  Bài tập tương tự:  Doc B, tr.12 — 5 câu mẫu cùng dạng
  Đề thi tương tự:   Doc C — đề thử THPT 2023 câu 38
  Video giải:        (Phase 3 — nếu có doc kèm video link)
```

### 🏆 Pillar 5 — Outcome-Verified Quality

★ rating dễ inflate / fake. Thay bằng signal thực:

```
Quality Score = weighted blend:
  35%  — outcome impact (% học sinh dùng doc → score boost trong quiz/exam)
  20%  — workspace import rate (commit signal > download)
  15%  — engagement (avg time spent reading)
  10%  — atom coverage (% syllabus atoms doc cover)
  10%  — tutor endorsement (verified educator vouch)
  10%  — community rating (★ vẫn count nhưng weight thấp)

Badge auto-grant:
  🏆 Outcome Verified  — ≥80% học sinh tiến bộ ≥1 điểm sau 4 tuần
  ✓ Educator Approved  — verified tutor endorse
  🎯 Syllabus Complete — cover ≥90% atoms trong syllabus
  ⚡ Power Resource    — top 5% workspace import rate
```

→ User trust signal **không thể fake** vì link với outcome real từ quiz/exam tracking.

### ⏱️ Pillar 6 — Time-Budget Study Mode

User gõ thời gian có sẵn, AI build kế hoạch.

```
User: "Tôi có 2h chiều nay — ôn gì hiệu quả nhất?"

AI:
  Hỏi context: môn? gap hiện tại?
  Build adaptive plan:
    0:00–0:15  Đọc tóm tắt 200 từ từ Doc A (atom yếu nhất)
    0:15–0:30  Flashcard 20 câu FSRS priority due
    0:30–1:00  Doc B trang 12-25 (lý thuyết hàm hợp)
    1:00–1:30  Quiz 10 câu mix dễ-khó
    1:30–1:50  Review 5 câu sai + đọc lời giải
    1:50–2:00  Atom map note + reflection

[Bắt đầu Focus Mode]
→ Timer chạy, notification block, distraction off
→ Sau 2h: report tự sinh "Bạn đã master 2 atom mới, 1 atom cần ôn"
```

---

## 🎁 Bonus Innovations (Phase 2-3)

### 7. **Knowledge Graph Navigation**

Click subject "Toán THPT" → visualize atom graph dạng node-edge. Click atom → list docs cover atom đó (ranked by quality). User navigate **kiến thức**, không phải file.

### 8. **Live Annotation Layer** (Genius-style)

Highlight đoạn PDF → annotation public/private. "Most highlighted" → top 5 đoạn quan trọng theo crowd. Comment threads inline.

### 9. **Audio Overview Podcast** (NotebookLM-style)

Button "🎧 Nghe podcast 15p về doc này" → AI generate 2-voice TTS conversation về key concepts. Học khi đi tàu / lái xe.

### 10. **Auto-Stitched Workspace**

Import 1 doc → AI suggest 3 doc bổ trợ (prerequisite + next-step + practice) → 1 click "Thêm hết" → workspace 4 doc + 60 flashcard + 3 quiz tự sinh.

### 11. **Cross-Language Live Translate**

Doc gốc IELTS Cambridge tiếng Anh → button "VN preview" → AI translate inline.

### 12. **Doc Remixing + Karma Loop**

User clone 3 doc + edit + bổ sung → "Save as Tổng hợp của tôi" → republish với attribution. Wiki-style knowledge compounding. Original creators được credit + karma.

### 13. **Difficulty + Prerequisite Chain**

Doc metadata gồm `difficulty` + `prerequisite_atoms`. User mở doc khó → AI cảnh báo "Nên đọc Doc X trước". Đảm bảo learning order đúng.

### 14. **Live Study Room** (Phase 3+)

Mở doc → tạo room → bạn bè join cùng đọc + chat realtime. Spaced repetition giải thích cho nhau.

### 15. **Mobile Voice Q&A**

Mobile app: long-press doc → hỏi câu hỏi bằng voice → AI trả lời dựa trên content doc. Hands-free learning.

---

## So sánh với competition

| Feature                   | Studocu | VnDoc       | Course Hero | Scribd  | NotebookLM | **Cogniva**  |
| ------------------------- | ------- | ----------- | ----------- | ------- | ---------- | ------------ |
| Browse/filter             | ✓       | ✓           | ✓           | ✓       | —          | ✓            |
| AI goal-driven discovery  | —       | —           | —           | —       | partial    | **✓**        |
| Cross-doc semantic search | —       | —           | —           | partial | —          | **✓**        |
| Atom-level slicing        | —       | —           | —           | —       | —          | **✓**        |
| Reverse problem search    | —       | —           | —           | —       | —          | **✓**        |
| Outcome-verified quality  | —       | —           | —           | —       | —          | **✓**        |
| Time-budget study mode    | —       | —           | —           | —       | —          | **✓**        |
| Auto-stitched workspace   | —       | —           | —           | —       | —          | **✓**        |
| Audio podcast overview    | —       | —           | —           | partial | ✓          | **✓**        |
| Knowledge graph nav       | —       | —           | —           | —       | —          | **✓**        |
| Live annotation           | —       | —           | partial     | —       | —          | **✓ P3**     |
| Remix + karma loop        | —       | —           | —           | —       | —          | **✓ P3**     |
| Pricing                   | $39/mo  | free + paid | $40/mo      | $11/mo  | free       | **freemium** |

→ Cogniva **innovate trên 9 dimension** mà competition chưa có.

---

## Phase rollout chi tiết

### **Phase 1 — Core MVP** (~7-10 ngày)

**Innovation deployed**: Pillar #1 Goal + #2 Cross-doc search + #4 Reverse search

Features:

- [ ] Upload PDF (max 20MB) → R2 storage + presigned URL
- [ ] Auto-extract: thumbnail trang 1 + page count + chunk + embed mọi chunk
- [ ] Upload form metadata (title, desc, subject, level, grade, doc_type, language, tags, license)
- [ ] AI auto-suggest metadata từ content (background job)
- [ ] List page `/library` với 3 modes:
  - **AI Concierge default** — goal-driven discovery
  - Browse by subject (chip nhanh + advanced filter modal)
  - Search bar (cross-doc semantic)
- [ ] Detail page `/library/[id]` — PDF.js viewer 5 trang preview watermarked + import CTA
- [ ] Cross-doc semantic search endpoint (RRF chunk-level)
- [ ] Reverse search: upload đề / ảnh → API search atoms
- [ ] Import to workspace: 1-click, atomic copy file → ingest pipeline trigger
- [ ] Rating 1-5 + comment
- [ ] Report copyright (admin queue)
- [ ] Pagination, sort, filter (collapsed default — power user expand)

### **Phase 2 — AI Intelligence** (~10-14 ngày)

**Innovation deployed**: Pillar #3 Atom-slicing + #5 Outcome verified + #6 Time-budget + Bonus #10 Auto-stitch

Features:

- [ ] Auto atom extraction từ doc (LLM batch process — Anthropic / OpenRouter)
- [ ] `library_doc_atom` table + atom-to-page mapping
- [ ] Atom checkmark sync với workspace mastery state
- [ ] Smart reading mode — hide pages chứa atoms đã master
- [ ] Outcome tracking pipeline:
  - Link doc import → workspace quiz/exam result
  - Compute score_delta sau 4 tuần
  - Update `library_doc_outcome` rolling avg
- [ ] Quality Score weighted blend → ranking signal
- [ ] Auto badges (Outcome Verified, Educator Approved, Syllabus Complete)
- [ ] Time-budget study mode — AI build adaptive plan
- [ ] Focus Mode UI — timer + notification block + distraction off
- [ ] Auto-stitch: import doc → suggest 3 related (prerequisite + next + practice)
- [ ] DOCX + image (OCR) support
- [ ] Duplicate detection (hash + content embedding similarity)

### **Phase 3 — Social + Audio + Graph** (~14 ngày)

**Innovation deployed**: Bonus #7 Graph + #8 Annotation + #9 Audio + #11 Translate + #12 Remix + #13 Prerequisite

Features:

- [ ] Knowledge Graph visualizer (subject-level atom graph)
- [ ] Click atom → docs cover atom (quality ranked)
- [ ] Live annotation system — highlight + comment public/private
- [ ] "Most highlighted" crowd signal hiện overlay PDF
- [ ] Audio podcast generation — TTS 2-voice từ doc summary
- [ ] Cross-language live translate (EN ↔ VN qua AI Router)
- [ ] Doc remix workspace — pick paragraphs từ 3 docs → tạo doc mới với attribution
- [ ] Karma loop — creator nhận credit khi remixed doc được clone
- [ ] Difficulty + prerequisite chain UI
- [ ] Tutor endorsement flow

### **Phase 4 — Monetization + Mobile** (~14 ngày)

- [ ] Subscription PRO: free 5 import/ngày, PRO unlimited + early access
- [ ] Paid premium docs (creator set giá VND, platform fee 20%)
- [ ] Wallet integration (reuse từ tutoring)
- [ ] Mobile voice Q&A
- [ ] Live study room realtime
- [ ] Saved searches + push alerts
- [ ] Creator dashboard analytics

---

## Data Model Comprehensive

### Phase 1 schema

```sql
-- ============================================================
-- library_doc — master record
-- ============================================================
CREATE TABLE library_doc (
  id              text PRIMARY KEY,
  uploader_id     text NOT NULL REFERENCES "user"(id),

  -- Content metadata
  title           text NOT NULL,
  description     text,
  subject_slug    text NOT NULL,
  level           text NOT NULL,                  -- PRIMARY/SECONDARY/HIGH_SCHOOL/UNIVERSITY/ADULT
  grade           integer,                         -- 1-12, null cho non-K-12
  doc_type        text NOT NULL DEFAULT 'other', -- enum: lecture_notes/summary/exam/exercise/solution/reference_book/thesis/handout/mind_map/other
  exam_type       text,                            -- midterm/final/graduation/university_entrance/gifted_student (chỉ khi doc_type=exam)
  school_year     text,                            -- '2023-2024' format
  region          text DEFAULT 'national',         -- national/hanoi/hcm/danang/...
  language        text DEFAULT 'vi',
  tags            text[] DEFAULT '{}'::text[],    -- topics: ['đạo hàm', 'tích phân']
  difficulty      text,                            -- easy/medium/hard (Phase 2 auto-detect)
  prerequisite_atom_slugs text[] DEFAULT '{}'::text[],

  -- File
  file_format     text NOT NULL,                  -- pdf/docx/image
  file_size_bytes integer NOT NULL,
  file_url        text NOT NULL,
  file_hash       text NOT NULL,                  -- SHA-256 dedup
  page_count      integer,

  -- Generated content
  preview_thumb_url text,                          -- trang 1 thumbnail
  ai_summary      text,                            -- 200 từ AI summary
  ai_summary_at   timestamp,
  preview_text    text,                            -- 500 char đầu

  -- Search index
  search_vec      tsvector,                       -- title + desc + ai_summary + preview_text
  title_embedding vector(1024),                   -- title + desc + summary
  -- (chunk embedding ở bảng riêng cho cross-doc search)

  -- License + status
  license         text DEFAULT 'CC-BY-4.0',       -- CC-BY-4.0/PUBLIC_DOMAIN/MINE_ONLY
  status          text DEFAULT 'PUBLISHED',
  hidden_at       timestamp,
  hidden_reason   text,

  -- Stats (Phase 1 basic)
  view_count             integer DEFAULT 0,
  download_count         integer DEFAULT 0,
  workspace_import_count integer DEFAULT 0,
  rating_avg             numeric(3,2),
  rating_count           integer DEFAULT 0,

  -- Quality Score Phase 2 (weighted blend updated periodically)
  quality_score          numeric(5,2),            -- 0-100
  quality_breakdown      jsonb,                    -- {outcome_pct, import_rate, engagement, atom_coverage, tutor_vouches, rating}
  badges                 text[] DEFAULT '{}'::text[],  -- ['outcome_verified', 'educator_approved', ...]

  -- Pricing (Phase 4)
  is_premium      boolean DEFAULT false,
  price_vnd       integer,
  creator_share_pct integer DEFAULT 80,

  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX library_doc_subject_grade_idx ON library_doc (subject_slug, grade, status);
CREATE INDEX library_doc_subject_level_idx ON library_doc (subject_slug, level, status);
CREATE INDEX library_doc_type_idx ON library_doc (doc_type, status);
CREATE INDEX library_doc_quality_idx ON library_doc (quality_score DESC NULLS LAST);
CREATE INDEX library_doc_uploader_idx ON library_doc (uploader_id);
CREATE INDEX library_doc_search_vec_gin ON library_doc USING gin(search_vec);
CREATE INDEX library_doc_tags_gin ON library_doc USING gin(tags);
CREATE UNIQUE INDEX library_doc_hash_uniq ON library_doc (file_hash) WHERE status = 'PUBLISHED';

-- ============================================================
-- library_doc_chunk — page-level chunks cho cross-doc semantic search
-- ============================================================
CREATE TABLE library_doc_chunk (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  page_num        integer NOT NULL,
  chunk_index     integer NOT NULL,                -- thứ tự chunk trong page (paragraph-level)
  content         text NOT NULL,
  content_vec     vector(1024),
  search_vec      tsvector
);

CREATE INDEX library_doc_chunk_doc_idx ON library_doc_chunk (doc_id, page_num);
CREATE INDEX library_doc_chunk_vec_idx ON library_doc_chunk USING ivfflat (content_vec vector_cosine_ops);
CREATE INDEX library_doc_chunk_fts_idx ON library_doc_chunk USING gin(search_vec);

-- ============================================================
-- library_doc_atom — Phase 2 atoms extracted
-- ============================================================
CREATE TABLE library_doc_atom (
  id          text PRIMARY KEY,
  doc_id      text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  atom_text   text NOT NULL,                        -- "đạo hàm hàm hợp"
  atom_slug   text NOT NULL,                        -- slugify cho dedup cross-doc
  page_nums   integer[] NOT NULL,                   -- [12, 13, 47]
  difficulty  text,                                  -- easy/medium/hard
  embedding   vector(1024)
);

CREATE INDEX library_doc_atom_slug_idx ON library_doc_atom (atom_slug);
CREATE INDEX library_doc_atom_doc_idx ON library_doc_atom (doc_id);

-- ============================================================
-- library_doc_review — rating + comment
-- ============================================================
CREATE TABLE library_doc_review (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  reviewer_id     text NOT NULL REFERENCES "user"(id),
  rating          integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         text,
  helpful_count   integer DEFAULT 0,
  created_at      timestamp NOT NULL DEFAULT now(),
  UNIQUE (doc_id, reviewer_id)
);

-- ============================================================
-- library_doc_import — track imports vào workspace
-- ============================================================
CREATE TABLE library_doc_import (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id),
  importer_id     text NOT NULL REFERENCES "user"(id),
  workspace_id    text REFERENCES workspace(id) ON DELETE SET NULL,
  document_id     text REFERENCES document(id) ON DELETE SET NULL,
  imported_at     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX library_doc_import_doc_idx ON library_doc_import (doc_id, imported_at);
CREATE INDEX library_doc_import_user_idx ON library_doc_import (importer_id, imported_at);

-- ============================================================
-- library_doc_outcome — Phase 2 outcome tracking
-- ============================================================
CREATE TABLE library_doc_outcome (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES "user"(id),
  metric          text NOT NULL,                    -- score_delta/time_spent/quiz_pass_rate/atom_mastered_count
  value           numeric NOT NULL,
  context         jsonb,                            -- {workspace_id, quiz_id, before_score, after_score, ...}
  recorded_at     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX library_doc_outcome_doc_idx ON library_doc_outcome (doc_id, metric);
CREATE INDEX library_doc_outcome_user_idx ON library_doc_outcome (user_id);

-- ============================================================
-- library_doc_annotation — Phase 3 live annotation
-- ============================================================
CREATE TABLE library_doc_annotation (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  author_id       text NOT NULL REFERENCES "user"(id),
  page_num        integer NOT NULL,
  selection       jsonb NOT NULL,                   -- {start_offset, end_offset, text, rect}
  note            text,
  visibility      text NOT NULL DEFAULT 'public',  -- public/private/workspace
  helpful_count   integer DEFAULT 0,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX library_doc_annotation_doc_idx ON library_doc_annotation (doc_id, page_num);

-- ============================================================
-- library_doc_report — moderation queue
-- ============================================================
CREATE TABLE library_doc_report (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id),
  reporter_id     text NOT NULL REFERENCES "user"(id),
  reason          text NOT NULL,                    -- spam/copyright/misinfo/inappropriate
  detail          text,
  status          text DEFAULT 'PENDING',           -- PENDING/ACTIONED/DISMISSED
  admin_id        text REFERENCES "user"(id),
  actioned_at     timestamp,
  created_at      timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- library_collection — Phase 2 playlist
-- ============================================================
CREATE TABLE library_collection (
  id              text PRIMARY KEY,
  creator_id      text NOT NULL REFERENCES "user"(id),
  title           text NOT NULL,
  description     text,
  doc_ids         text[] NOT NULL,
  goal_template   text,                             -- "ôn thi tốt nghiệp" / "luyện đề chuyên" / ...
  estimated_hours integer,
  clone_count     integer DEFAULT 0,
  created_at      timestamp NOT NULL DEFAULT now()
);
```

---

## Tech Architecture

### Indexing Pipeline (Phase 1)

```
Upload PDF
    │
    ▼
┌─────────────────────────────────────┐
│ /api/library/docs/upload-init       │
│ POST {filename, size, hash}         │
│ → check dup hash                    │
│ → presigned R2 URL                  │
└─────────────────────────────────────┘
    │
    ▼
Client PUT file → R2 direct
    │
    ▼
┌─────────────────────────────────────┐
│ /api/library/docs (finalize)        │
│ POST metadata + R2 key              │
│                                     │
│ Synchronous (fast):                 │
│   1. INSERT library_doc (status=PROCESSING)
│   2. Trigger background jobs        │
│   3. Return doc.id immediately      │
└─────────────────────────────────────┘
    │
    ▼
Background jobs (BullMQ queue)
    │
    ├─► Job 1: PDF parse
    │     - pdf.js extract text per page
    │     - sharp generate thumbnail trang 1
    │     - INSERT library_doc_chunk per paragraph
    │     - Embed chunks (batch API call)
    │
    ├─► Job 2: AI summary
    │     - Send first 5 pages text → LLM (1024 token max)
    │     - Generate title suggestion + 200-word summary
    │     - UPDATE library_doc.ai_summary
    │
    ├─► Job 3: AI metadata enrichment
    │     - Detect language (Phase 2)
    │     - Suggest subject_slug + level + grade + tags
    │     - Auto-detect doc_type (exam/lecture/exercise/...)
    │     - UPDATE library_doc fields if uploader didn't set
    │
    ├─► Job 4: AI atom extraction (Phase 2)
    │     - LLM scan doc + extract atoms with page mapping
    │     - INSERT library_doc_atom rows
    │     - Compute difficulty per atom
    │
    └─► Job 5: Mark PUBLISHED
          - UPDATE status = PUBLISHED
          - Generate search_vec tsvector
          - Update title_embedding
```

### Storage & R2 (cập nhật 2026-05-30)

Toàn dự án thống nhất 1 bucket R2 (`R2_BUCKET_NAME`, hiện `cogniva-recordings`),
phân tách bằng prefix key. Hai con đường ghi:

1. **Browser → R2 trực tiếp (presigned PUT)** — chỉ Library upload (`upload-init` →
   client PUT → `finalize`). Vì là cross-origin tới `r2.cloudflarestorage.com`,
   **bucket BẮT BUỘC có CORS policy** cho origin app (PUT/GET/HEAD). Thiếu CORS →
   browser chặn → "Failed to fetch". CORS set 1 lần trên Cloudflare dashboard
   (JSON ở `apps/web/scripts/r2-cors-policy.json`); token R2 scope "Object" KHÔNG
   set được CORS qua API (cần "Admin" — script `scripts/setup-r2-cors.ts`). Kiểm:
   `scripts/verify-r2-cors.ts` (preflight OPTIONS).

2. **Server → R2 (multipart nhận ở server, không dính CORS)** — qua abstraction
   `lib/storage` (`getStorage()`): workspace docs, flashcard image, group
   attachment, KYC. Driver chọn theo `STORAGE_DRIVER` (`r2` | `local`; bỏ trống →
   auto: có R2 creds dùng `r2`). Driver R2 ở `lib/storage/r2.ts` tái dùng helper
   `lib/r2-client.ts`. Recordings đi LiveKit Egress (S3) cũng server-side.

| Prefix key                    | Nội dung                     | Đường ghi                        |
| ----------------------------- | ---------------------------- | -------------------------------- |
| `lib/{uid}/{docId}.*`         | Library doc + `-thumb.jpg`   | browser presigned + server thumb |
| `{uid}/{docId}.pdf`           | Workspace document           | server (getStorage)              |
| `group-attachments/{uid}/...` | Đính kèm chat nhóm           | server (getStorage)              |
| `flashcards/{uid}/...`        | Ảnh flashcard                | server (getStorage)              |
| `kyc/{id}/...`                | Giấy tờ KYC tutor (nhạy cảm) | server (getStorage)              |
| `recordings/...`              | MP4 phòng học                | LiveKit Egress (S3)              |

Migrate file local cũ → R2: `scripts/migrate-local-uploads-to-r2.ts` (idempotent).
Roundtrip test driver: `scripts/verify-r2-storage.ts`.

### Search Engine (Phase 1)

3-tier ranking:

```
Query: free-text + filters
    │
    ▼
Tier 1: Hard filter (subject_slug, grade, doc_type, language, ...)
    SELECT * FROM library_doc WHERE filters AND status='PUBLISHED'
    │
    ▼
Tier 2: Hybrid RRF
    ┌─────────────┬─────────────┐
    │ FTS         │ Vector      │
    │ search_vec  │ chunk-level │
    │ (title+desc+│ (vector     │
    │  summary)   │  cosine)    │
    └─────────────┴─────────────┘
            │
            RRF fusion (k=60)
            │
            ▼
    Top 50 candidate docs
    │
    ▼
Tier 3: Quality + personalization rerank
    final_score = rrf_score * 0.4
                + quality_score * 0.3
                + atom_coverage_for_user * 0.2    (Phase 2)
                + outcome_signal * 0.1             (Phase 2)
    │
    ▼
Top 24 / page
```

### Cross-Doc Semantic Search (Pillar #2)

```
SELECT doc.id, chunk.page_num, chunk.content
FROM library_doc_chunk chunk
JOIN library_doc doc ON doc.id = chunk.doc_id
WHERE doc.status = 'PUBLISHED'
  AND (filters...)
ORDER BY chunk.content_vec <=> :query_embedding ASC
LIMIT 20;
```

Hybrid với FTS chunk-level cũng:

```
SELECT doc.id, chunk.page_num, ts_rank(chunk.search_vec, query)
FROM library_doc_chunk chunk
WHERE chunk.search_vec @@ to_tsquery(:query)
ORDER BY ts_rank DESC LIMIT 20;
```

RRF fuse 2 lists → final chunk ranking.

### Reverse Search (Pillar #4)

```
User upload đề / ảnh
    │
    ▼
OCR pipeline
    - PDF: pdf.js text extract
    - Image: Google Cloud Vision / Tesseract
    - Photo + handwriting: GPT-4o vision
    │
    ▼
LLM parse: extract question + topic + difficulty
    Output: { topic: "tích phân từng phần", difficulty: "hard", atom_slugs: [...] }
    │
    ▼
Search library:
    1. library_doc_atom có atom_slug match → return docs
    2. library_doc_chunk vector similarity với question embedding
    3. Combine + rank
    │
    ▼
Output:
    Lý thuyết: top 3 doc (lecture_notes/summary type)
    Bài tập:   top 5 doc (exercise type)
    Đề mock:   top 3 doc (exam type)
```

### Goal Parser (Pillar #1)

```ts
// apps/web/src/lib/library/goal-parser.ts
type StudyGoal = {
  subject_slug: string;
  level?: string;
  grade?: number;
  deadline?: Date;
  current_score?: number;
  target_score?: number;
  exam_type?: 'graduation' | 'university_entrance' | 'gifted' | ...;
  focus_atoms?: string[];     // explicit user mention
};

async function parseGoal(userMessage: string, context: WorkspaceContext): Promise<StudyGoal>;
async function buildStudyPlan(goal: StudyGoal): Promise<StudyPlan>;
```

LLM Router gọi `useCase: 'classify'` extract structured goal → backend build plan từ library search + atom analysis.

---

## UI Mockups

### Hub `/library` — AI-first

```
╔════════════════════════════════════════════════════════════════════╗
║  📚 Kho Tài Liệu                          [Tải lên] [Của tôi]      ║
╠════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  ┌────────────────────────────────────────────────────────────┐   ║
║  │  💬  Bạn cần học gì hôm nay?                                │   ║
║  │      "Ôn tích phân lớp 12 trong 1 tuần"                    │   ║
║  │      "Tìm đề thi Toán THPT 2024 có lời giải"               │   ║
║  │      "Upload đề khó → tìm tài liệu giải"                   │   ║
║  └────────────────────────────────────────────────────────────┘   ║
║                                                                    ║
║  ⚡ Quick start:                                                   ║
║  [🎯 Mục tiêu của tôi]  [📷 Upload đề tìm giải]  [🎧 Có audio]   ║
║                                                                    ║
║  ─────────────── Hoặc browse theo môn ───────────────             ║
║                                                                    ║
║  [Toán] [Lý] [Hoá] [Văn] [Anh] [IELTS] [Lập trình] [+ Bộ lọc]    ║
║                                                                    ║
║  🎯 Phù hợp với workspace "Toán 12 ôn thi" của bạn                ║
║  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                             ║
║  │ Doc  │ │ Doc  │ │ Doc  │ │ Doc  │                             ║
║  │ 🏆✓  │ │ 🏆   │ │ 🎯   │ │  ⚡  │                             ║
║  └──────┘ └──────┘ └──────┘ └──────┘                             ║
║                                                                    ║
║  📊 Hôm nay phổ biến                                              ║
║  ...                                                              ║
║                                                                    ║
║  🏆 Outcome Verified (≥80% học sinh tiến bộ)                      ║
║  ...                                                              ║
║                                                                    ║
║  📦 Bộ sưu tập theo mục tiêu                                      ║
║  • Ôn thi tốt nghiệp 2025 — 24 doc, 4 tuần                       ║
║  • Luyện chuyên Toán — 18 doc, 6 tuần                            ║
║  • IELTS 7.0 trong 3 tháng — 30 doc, 12 tuần                     ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
```

### Detail `/library/[id]` — rich preview

```
╔════════════════════════════════════════════════════════════════════╗
║  ← Kho Tài Liệu                                                    ║
╠════════════════════════════════════════════════════════════════════╣
║  ┌───────────────────────────────┬──────────────────────────────┐ ║
║  │                                │  📄 Đề cương Toán 12        │ ║
║  │   [PDF Preview                 │     đạo hàm + tích phân     │ ║
║  │    5 trang đầu                 │                              │ ║
║  │    + watermark]                │  🏆 Outcome Verified        │ ║
║  │                                │  ✓ Educator Approved        │ ║
║  │   [Smart Read OFF / ON]        │  🎯 Cover 18/20 atoms       │ ║
║  │   ☑ Đã master 5/12 atoms      │                              │ ║
║  │   → show only 28/200 trang    │  Tác giả: Nguyễn Minh        │ ║
║  │                                │  ⭐ 4.8 (124 review)         │ ║
║  │                                │  📥 1,234 import workspace  │ ║
║  │                                │  ⏱ ~3h đọc                 │ ║
║  │                                │                              │ ║
║  │                                │  📝 Tóm tắt AI 200 từ:       │ ║
║  │                                │  "Doc trình bày đạo hàm     │ ║
║  │                                │   hàm bậc 1-3, tích phân    │ ║
║  │                                │   cơ bản và ứng dụng..."    │ ║
║  │                                │                              │ ║
║  │                                │  🧩 Atoms (12):              │ ║
║  │                                │  ☑ Đạo hàm hàm bậc 1        │ ║
║  │                                │  ☑ Đạo hàm hàm bậc 2        │ ║
║  │                                │  ☐ Đạo hàm hàm hợp ← yếu    │ ║
║  │                                │  ☐ Tích phân từng phần      │ ║
║  │                                │  ...                         │ ║
║  │                                │                              │ ║
║  │                                │  ┌────────────────────────┐ │ ║
║  │                                │  │ + Thêm vào Workspace   │ │ ║
║  │                                │  └────────────────────────┘ │ ║
║  │                                │  [Tải về]  [🎧 Nghe podcast]│ ║
║  │                                │  [Báo cáo]                  │ ║
║  └───────────────────────────────┴──────────────────────────────┘ ║
║                                                                    ║
║  💡 AI suggest 3 doc bổ trợ:                                       ║
║  • Đạo hàm cơ bản (prerequisite) — Cover 3 atoms thiếu             ║
║  • Bài tập đạo hàm hàm hợp (practice) — 50 câu mẫu                ║
║  • Đề thi THPT 2024 (challenge) — full mock                        ║
║  [Thêm hết 4 doc vào workspace mới] →                              ║
║                                                                    ║
║  💬 Review (124)                                                   ║
║  ★★★★★ "Đề cương rất chi tiết, ôn hiệu quả lắm" — Mai 5 ngày      ║
║  ★★★★☆ "Tốt nhưng thiếu một số ví dụ phức tạp" — Đức 2 tuần       ║
║  ...                                                               ║
╚════════════════════════════════════════════════════════════════════╝
```

### Goal Mode (Pillar #1 trigger)

User click "🎯 Mục tiêu của tôi" → wizard:

```
╔══════════════════════════════════════════════╗
║  🎯 Bạn muốn đạt điều gì?                     ║
║                                                ║
║  Mục tiêu: [Ôn thi tốt nghiệp Toán THPT  ▾]   ║
║  Thời hạn: [4 tuần ▾]                          ║
║  Điểm hiện tại: [7.5 ▾]                        ║
║  Điểm mong muốn: [9.0 ▾]                       ║
║                                                ║
║  ─────────────────────                         ║
║  AI đang phân tích…                            ║
║                                                ║
║  ✓ Đã xác định 12 atom cần master              ║
║  ✓ Tìm 24 doc phù hợp                          ║
║  ✓ Build kế hoạch 4 tuần                       ║
║                                                ║
║  📅 Tuần 1: Đạo hàm + ứng dụng                ║
║     • Doc A (lý thuyết, tr.12-30)              ║
║     • Doc B (bài tập, 50 câu)                  ║
║     • Đề mock cuối tuần                        ║
║  📅 Tuần 2: Tích phân                          ║
║     ...                                        ║
║                                                ║
║  [Tạo workspace ôn thi này] [Điều chỉnh]      ║
╚══════════════════════════════════════════════╝
```

---

## Workspace Integration

### Document tab existing → thêm option "From library"

```
Workspace: "Toán 12 ôn thi"
┌─────────────────────────────────────────────────┐
│  📄 Documents          [+ Upload] [+ From library] ← MỚI
│                                                 │
│  📄 Đề cương Toán 12.pdf  • 15p • 2.3M         │
│  📄 Lý thuyết hàm số.pdf  • 8p • 1.1M          │
│                                                 │
└─────────────────────────────────────────────────┘
```

Click "From library" → modal mini browse với filters prefilled từ workspace context (subject = workspace.subject, level = workspace.level).

### AI Concierge integration

User trong workspace → mở Concierge → gõ "tìm tài liệu đạo hàm" → planner action `library_search` → SSE stream cards có CTA "Thêm vào workspace" 1-click.

### Cross-link tutoring

Doc creator là tutor verified → badge "Có gia sư hướng dẫn" → click → book buổi học với content sẵn.

---

## AI Concierge — New Actions

```ts
type ConciergeAction =
  | { type: 'clarify'; ... }
  | { type: 'search'; ... }           // existing — tutor / request search
  | { type: 'tutor_detail'; ... }     // existing
  | { type: 'faq'; ... }               // existing

  // NEW for library
  | {
      type: 'library_search';
      role: ConciergeRole;
      query: string;                   // semantic query
      filters: {
        subjectSlug?: string;
        grade?: number[];
        docType?: string[];
        // ... cũng support tags, exam_type, etc.
      };
      reason?: string;
    }
  | {
      type: 'library_goal';            // Pillar #1
      goal: StudyGoal;
    }
  | {
      type: 'library_reverse_search'; // Pillar #4
      problemText: string;
      problemImageUrl?: string;
    };
```

Planner prompt mở rộng với rule + ví dụ cho 3 action mới.

---

## Storage + Cost Model

### R2 storage

- 1 PDF avg 2MB
- 10k docs = 20GB = **$0.30/tháng**
- 100k docs = 200GB = **$3/tháng**
- Egress within Cloudflare = $0

### LLM cost (chuyên cho library)

- AI summary (200 từ): ~$0.0001/doc với Llama Free tier
- Atom extraction (Phase 2): ~$0.001/doc với Claude Haiku/Sonnet
- Embedding (chunks): ~$0.0005/doc (avg 50 chunks × $0.00001/chunk)
- Goal parser: ~$0.00005/query

**Total cost 10k docs**: ~ $15 one-time + $1/k library_search/month → negligible.

### Limits Phase 1

- Max 20MB / file (block thesis dày)
- Max 50 doc / user (anti-abuse free)
- Max 5 upload / ngày user mới
- Max 10MB hash dedup window

---

## Moderation + Copyright (critical VN)

### Soft (Phase 1)

- Upload form bắt tick xác nhận quyền + chọn license
- Min metadata: title ≥ 10 char, desc ≥ 50 char
- Report button → admin queue
- New uploader first 3 docs → admin pre-approval
- Auto-hide docs rating < 2.5 sau 10+ review

### AI (Phase 2)

- Fingerprint detect SGK NXB Giáo dục (curated hash database)
- OCR text + topic analysis flag suspicious content
- Duplicate detect: hash exact + content vector similarity > 0.92
- LLM scan flag low-quality (keyword stuffing, off-topic)

### Hard (Phase 4)

- DMCA-style takedown form
- 3-strike ban repeat offender
- Whitelist verified educator bypass pre-approval

### VN-specific policy

- ❌ SGK NXB Giáo dục (sách giáo khoa chính)
- ❌ Sách tham khảo có copyright (Hocmai, Vietjack, ...)
- ✅ Đề cương / vở ghi tự soạn
- ✅ Đề thi cũ ≥ 3 năm (de facto public)
- ✅ Bài giảng trường tự upload
- ✅ Luận văn ĐH (creator có quyền)
- ⚠️ Đề thi mới ≤ 1 năm → admin review case-by-case

---

## Reuse Cogniva Infrastructure

✅ **R2 storage** (lib/storage/r2.ts) — setup từ voice recording
✅ **PDF.js viewer** — đã có ở documents tab workspace
✅ **Ingest pipeline** — chunk + embed pipeline đã có cho RAG workspace
✅ **AI Router multi-provider** — Llama/OpenRouter/Gemini routing
✅ **embedQuery 1024-dim** — text-embedding-3-large
✅ **Hybrid search RRF** — copy pattern từ tutoring V5 hybrid-search
✅ **Pagination + ListToolbar** — V5 components ready
✅ **AI Concierge SSE** — extend với action mới
✅ **BullMQ background jobs** — pipeline async đã có cho voice recording transcription
✅ **Atom system** — workspace atoms đã có, library link qua atom_slug
✅ **FSRS flashcard engine** — auto-generate flashcard sau import
✅ **Quiz/exam engine** — outcome tracking integration
✅ **Wallet** — Phase 4 monetization reuse từ tutoring

→ Phase 1 build **95% reuse**, chỉ ~ 5% code mới (CRUD + UI library specific).

---

## File Structure (Phase 1)

```
packages/db/migrations/
  └─ 0046_library_doc.sql          # 4 tables Phase 1

packages/db/src/schema.ts          # Drizzle definitions

apps/web/src/lib/library/
  ├─ hybrid-search-doc.ts          # RRF doc-level search
  ├─ cross-doc-search.ts           # Chunk-level semantic search (Pillar #2)
  ├─ goal-parser.ts                # Goal → StudyGoal struct (Pillar #1)
  ├─ study-plan-builder.ts         # Build plan từ goal + library
  ├─ reverse-search.ts             # Problem → docs (Pillar #4)
  ├─ upload.ts                     # presigned URL + finalize
  ├─ import.ts                     # copy file → workspace document
  └─ ai-metadata.ts                # Auto-suggest metadata

apps/web/src/lib/library/jobs/
  ├─ pdf-parse.ts                  # BullMQ job extract chunk + thumbnail
  ├─ ai-summary.ts                 # BullMQ job generate summary
  ├─ ai-enrich.ts                  # BullMQ job suggest metadata
  └─ atom-extract.ts               # BullMQ job (Phase 2) extract atoms

apps/web/src/app/api/library/
  ├─ docs/
  │   ├─ route.ts                  # POST upload-finalize, GET list
  │   ├─ [id]/
  │   │   ├─ route.ts              # GET detail, DELETE
  │   │   ├─ download/route.ts     # GET signed URL
  │   │   ├─ import/route.ts       # POST import workspace
  │   │   ├─ reviews/route.ts      # POST/GET reviews
  │   │   ├─ report/route.ts       # POST report
  │   │   └─ atoms/route.ts        # GET atoms (Phase 2)
  │   ├─ upload-init/route.ts      # POST presigned URL
  │   └─ search/
  │       ├─ cross-doc/route.ts    # POST chunk-level search
  │       └─ reverse/route.ts      # POST reverse search
  └─ collections/route.ts          # Phase 2

apps/web/src/app/(app)/library/
  ├─ page.tsx                      # Hub /library
  ├─ [id]/page.tsx                 # Detail
  ├─ upload/page.tsx               # Upload wizard
  ├─ goal/page.tsx                 # Goal wizard (Pillar #1)
  └─ reverse/page.tsx              # Reverse search upload (Pillar #4)

apps/web/src/components/library/
  ├─ doc-card.tsx                  # Item card grid
  ├─ doc-card-list.tsx             # List view variant
  ├─ filter-panel.tsx              # Collapsed by default
  ├─ goal-wizard.tsx               # AI goal-driven discovery
  ├─ reverse-search-form.tsx       # Upload đề
  ├─ pdf-preview-watermark.tsx     # PDF.js with watermark overlay
  ├─ smart-read-toggle.tsx         # Atom-slicing UI (Phase 2)
  ├─ import-modal.tsx              # Choose workspace + import
  ├─ quality-badges.tsx            # Outcome/Educator/Syllabus badges
  ├─ upload-wizard.tsx             # 4-step upload form
  └─ ai-suggest-related.tsx        # Auto-stitch suggestions

apps/web/scripts/
  ├─ seed-library-docs-v1.ts       # 50+ doc mẫu Phase 1
  └─ eval-library-search.ts        # Test fixtures search accuracy
```

---

## Test Strategy

### Phase 1 fixtures

```json
[
  { "goal": "ôn tích phân lớp 12 trong 1 tuần", "expect": { "type": "library_goal", "subject": "math", "grade": 12 } },
  { "query": "định lý Vi-et", "expect": { "minChunkResults": 3 } },
  { "reverseSearch": "ảnh đề tích phân", "expect": { "atomMatchCount": 1, "minDocResults": 5 } },
  { "filter": { "subject": "math", "grade": 12, "docType": "exam" }, "expect": { "minResults": 10 } },
  ...
]
```

### Eval runner

- Goal parser accuracy
- Cross-doc search recall@10
- Reverse search precision@5
- Quality Score correlation với manual judgment

CI integration: `pnpm eval:library` ≥ 85% accuracy threshold.

---

## Success Metrics (post-launch)

### Engagement

- **Upload rate**: >50 doc/tuần đầu, >500/tháng sau Phase 2
- **Search → import conversion**: ≥ 25%
- **Workspace activate rate**: doc imported → user dùng ≥ 1 lần trong 7 ngày ≥ 60%
- **Goal Mode usage**: ≥ 30% search session start qua Goal Mode (Pillar #1 adoption signal)

### Quality

- **Cross-doc search satisfaction**: NPS ≥ 8 cho feature mới
- **Atom-slicing time saved**: avg user read 30% pages vs 100% (3x efficiency)
- **Outcome score correlation**: docs có outcome_verified badge → user thực sự cải thiện ≥ 1 điểm trong 4 tuần ≥ 80% cases

### Business

- **Free → PRO conversion** (Phase 4): ≥ 5% MAU
- **Creator retention**: creator publish > 3 doc → return publish trong 30 ngày ≥ 40%

---

## Risks & Mitigations

| Risk                           | Probability | Impact | Mitigation                                                                          |
| ------------------------------ | ----------- | ------ | ----------------------------------------------------------------------------------- |
| Library trống chicken-egg      | High        | High   | Seed 50+ doc Phase 1 + incentive tutor publish (1 month PRO free khi publish 5 doc) |
| Copyright vi phạm massive      | Med         | High   | Strict license tick + AI fingerprint Phase 2 + DMCA flow                            |
| Atom extraction inaccurate     | Med         | Med    | Use Claude Sonnet (not Haiku) cho atom job + manual override creator                |
| Cross-doc search nhiều noise   | Med         | Med    | RRF + quality reranking + min similarity threshold 0.7                              |
| Goal Mode LLM hallucinate plan | Med         | High   | Constrain output qua structured schema + sanity check atom coverage                 |
| Storage cost spike             | Low         | Low    | 20MB/file limit + hash dedup                                                        |
| Outcome data sparse early      | High        | Med    | Bootstrap với star rating Phase 1, switch sang outcome dần Phase 2                  |

---

## Open Decisions

1. **Phase 1 chỉ PDF hay DOCX/image luôn?**
   - Recommend: **chỉ PDF Phase 1** — DOCX cần convert phức tạp, image cần OCR (Phase 2)
2. **Watermark "Cogniva Library" trên preview?**
   - Recommend: **có**, defensive copyright
3. **Free Phase 1 hoặc setup subscription gateway sớm?**
   - Recommend: **free hoàn toàn Phase 1-3**, monetize Phase 4 khi đủ critical mass
4. **Pre-launch seed strategy?**
   - Recommend: 50+ doc curated chất lượng cao (ưu tiên Toán THPT + IELTS hot subject) + invite 10 tutor verified publish 5 doc mỗi người
5. **Goal templates** cho Pillar #1 — manual curate hay AI tự build?
   - Recommend: 10 template hand-curated launch + AI extend sau
6. **Smart Reading default ON hay OFF?**
   - Recommend: **ON** default — innovation visible ngay, user nào không thích toggle OFF

---

## Estimate tổng thời gian

| Phase                                                   | Time        | Cost-impact features                   |
| ------------------------------------------------------- | ----------- | -------------------------------------- |
| Phase 1 — Core (Pillar #1+2+4)                          | 7-10 ngày   | Goal Mode + Cross-doc + Reverse search |
| Phase 2 — AI Intelligence (Pillar #3+5+6 + Auto-stitch) | 10-14 ngày  | Atom slicing + Outcome + Time-budget   |
| Phase 3 — Social/Audio/Graph (Pillar #7-#13)            | 14 ngày     | Annotation + Audio + Graph + Remix     |
| Phase 4 — Monetization + Mobile                         | 14 ngày     | PRO + Paid + Voice + Live room         |
| **Total**                                               | **~7 tuần** | Library production-grade               |

---

## Khởi động Phase 1

Sẵn sàng ship Phase 1 trong 7-10 ngày với 3 innovation pillar:

- 🎯 Goal-driven discovery
- 🔍 Cross-doc semantic search
- 📷 Reverse problem search

Lúc đó library đã KHÁC competition rõ rệt, user sẽ "wow" ngay turn đầu.

---

## ✅ Decisions confirmed (2026-05-22)

1. **Formats Phase 1**: **PDF + DOCX + Image** (cả 3 cùng support ngay)
2. **Watermark preview**: ✓ có "Cogniva Library"
3. **Pricing**: Free Phase 1-3, monetize Phase 4
4. **Seed strategy**: 50+ doc curated + invite 10 tutor publish 5 mỗi
5. **Goal templates**: 10 hand-curated launch + AI extend
6. **Smart Reading**: default ON

**Estimate revised**: +2-3 ngày do thêm DOCX + Image (OCR) → **Phase 1 ~10-13 ngày dev**.

---

## ✅ Phase 2 — SHIPPED 2026-05-27

5 mảng ship lần lượt:

### Pillar #3 — Atom-Level Slicing

- `apps/web/src/lib/library/atom-extractor.ts` — LLM job (Groq fallback OpenRouter, cost $0)
- `apps/web/src/app/api/library/docs/[id]/atoms/route.ts` — GET (mastery overlay via concept embedding cosine ≥ 0.78) + POST (re-extract owner-only)
- `apps/web/src/components/library/doc-atom-map.tsx` — atom map panel + Smart Reading toggle + time-saved %
- Auto-trigger sau `ingest.ts` PUBLISHED
- Backfill 17 doc → 130 atoms (script `backfill-library-atoms.ts`)

### Pillar #5 — Outcome-Verified Quality

- `apps/web/src/lib/library/quality-score.ts` — pure formula 5-factor weighted blend + recompute helpers
- `apps/web/src/lib/library/outcome-tracker.ts` — recordExamOutcome / recordQuizOutcome (4-tuần attribution window)
- Wire vào `api/attempts/[id]/submit/route.ts` (exam) + `api/quiz/[id]/attempt/route.ts` (quiz)
- `api/library/admin/recompute-quality/route.ts` + script `recompute-library-quality.ts`
- 4 auto badges: outcome_verified, syllabus_complete, power_resource, educator_approved (Phase 3 tutor)
- Quality Score widget trên detail page

### ~~Pillar #6 — Time-Budget Study Mode~~ (REMOVED 2026-05-27)

- ❌ Gỡ sạch sau khi ship — user feedback: "thêm vào workspace học rồi cần cái này làm gì"
- Lý do: Library là discovery + import; chỗ học là workspace. Time-Budget không thuộc library hub UX
- Code đã xoá: `time-budget-planner.ts`, `time-budget-card.tsx`, `api/library/time-budget/route.ts`
- Nếu cần tính năng Focus Mode/Pomodoro trong tương lai → mount trong workspace, không phải library

### Bonus #10 — Auto-Stitched Workspace

- `apps/web/src/lib/library/related-docs.ts` — atom-overlap + role classification (prerequisite/next_step/practice)
- `api/library/docs/[id]/related/route.ts` + `api/library/import-batch/route.ts` (max 10 docs/batch)
- `components/library/related-docs-section.tsx` — 3-card section + bulk-import dialog (source + N related)
- Wire vào detail page sau preview

### Duplicate Detection

- `apps/web/src/lib/library/duplicate-detect.ts` — pgvector cosine, 2 thresholds (0.85 similar / 0.92 near-duplicate)
- Auto-flag → `library_doc_report` row admin queue
- `api/library/docs/[id]/duplicates/route.ts` + `components/library/duplicate-warning.tsx` (banner)
- Hook async vào ingest pipeline
- Script `scan-library-duplicates.ts` (dry-run + commit modes)

**Phase 2 metrics**: ~14 file mới, $0 cost trên seed run (Groq free tier). Typecheck PASS.

---

## ✅ Phase 3 — SHIPPED 2026-05-27

7 features tuần tự ship hết — Library production-grade với social, discovery, multimedia.

### Bonus #13 — Difficulty + Prerequisite Chain

- `difficulty-prereq.ts` heuristic compute + LLM prereq extract (Groq, $0)
- `?difficulty=easy/medium/hard` filter trên hybrid search
- `PrereqWarning` sidebar banner với cross-ref user mastery (✓/○ checkmarks)
- Backfill 17 docs (9 medium / 4 hard / 4 easy)

### Bonus #11 — Cross-language Translate

- `/api/library/docs/[id]/translate` POST endpoint (~$0.0001/req Groq)
- `TranslateButton` + `TranslatableText` components — inline toggle gốc ↔ dịch
- Wire AI tóm tắt + description

### Bonus #7 — Knowledge Graph Navigation

- `/api/library/graph` co-occurrence edges (weight ≥ 2)
- `/api/library/graph/atom-docs` top docs per atom
- `LibraryGraphView` ReactFlow + Dagre LR layout (size+color encoded)
- Page `/library/graph?subject=...` với subject tabs + side panel docs

### Tutor Endorsement

- Migration 0047 `library_doc_endorsement` table
- `/api/library/docs/[id]/endorse` GET/POST/DELETE (KYC verified tutor only)
- `EndorseSection` UI với list endorsers + form
- `educator_approved` badge auto-grant qua quality recompute

### Bonus #9 — Audio Podcast NotebookLM-style

- `/api/library/docs/[id]/podcast` LLM generate 2-voice dialogue (Linh + Minh)
- `PodcastPlayer` Web Speech API client TTS ($0 cost browser)
- Controls: play/pause/skip/speed + transcript với role colors

### Bonus #8 — Live Annotation (page-level v1)

- Migration 0048: `library_doc_annotation` + `library_doc_annotation_vote`
- CRUD + helpful vote toggle (transaction-safe unique constraint)
- `AnnotationsSection` grouped by page, public/private, vote count
- Phase 4 sẽ thêm pixel-perfect text selection overlay PDF

### Bonus #12 — Doc Remix + Karma Loop

- Migration 0049: `parent_remix_doc_ids` + `remix_count` columns + `library_creator_karma` + `library_karma_event` tables
- `awardKarma()` helper (+1 import / +5 remix / +10 endorse / +20 high quality)
- Hook karma vào import + endorse endpoints
- `/api/library/remix` POST: validate 2-5 sources → bulk copy chunks → award karma
- `/library/remix` page với 2-pane builder (picker + form)
- Detail page: attribution banner "Tổng hợp từ N nguồn" + remix count stat
- Nav button "Tạo Tổng Hợp"

**Phase 3 metrics**: ~22 file mới, 3 migrations (0047/0048/0049), $0 cost (Groq free). Typecheck PASS.

---

## ✅ Phase 4 Step 1 — SHIPPED 2026-05-27

Hoàn thiện UX + thay placeholder bằng real content. 4 mảng done:

### 1. Real PDFs cho seed docs

- `generate-real-pdfs-for-seeds.ts` script dùng `pdf-lib` tạo PDF từ chunks content
- 17/17 PDFs upload R2 thành công (1.5-2.3KB/file, 2-4 pages)
- R2 client fallback `R2_BUCKET_NAME` + `R2_PUBLIC_URL` env (shared bucket pattern)
- Download endpoint: chỉ trả demo cho `remix://` prefix (seed-v1 đã thay thật)
- Note: pdf-lib StandardFonts ASCII-only — diacritics tiếng Việt strip qua transliterate. Phase 5 sẽ embed font Roboto/Noto.

### 2. Karma Leaderboard `/library/karma`

- API `/api/library/karma/leaderboard` (top 20 + 15 recent events)
- Page với 4 stats cards (events by type) + leaderboard list (medal cho top 3) + activity feed sidebar + karma earning guide

### 3. Creator Dashboard `/library/me`

- Server page show user's docs + aggregate stats (5 cards: karma + imports + downloads + remixes + endorses)
- Doc list với badges + quality + import/download/remix counts mỗi card
- Sidebar karma earn history (10 latest events) + link tới leaderboard

### 4. Saved Searches + Recently Viewed

- Migration 0050: `library_saved_search` + `library_doc_view` tables
- `/api/library/saved-searches` GET/POST + DELETE per id
- View history upsert vào detail GET endpoint (1 row/user × doc, update viewed_at)
- `RecentlyViewed` strip horizontal scroll trên library hub (10 latest)
- `SavedSearchBar` strip với "Đã lưu" pills + "💾 Lưu tìm kiếm này" CTA khi có active filters

**Phase 4 Step 1 metrics**: ~9 file mới + 1 migration (0050) + 1 lib (pdf-lib). Typecheck PASS.

---

## ✅ Phase 4 Step 3 — SHIPPED 2026-05-27 (Pixel-perfect highlight overlay)

- `annotation-events.ts` — shared event bus (SELECT/LOADED/HOVER/FOCUS) cross-component
- DocPreviewPanel onMouseUp capture `selectionRect` normalized 0..1 (range bounding rect / page bounding rect, clamped)
- `PageHighlightOverlay` render rect màu vàng absolute % positioned per annotation; hover state border đậm; click → FOCUS event scroll list card + flash
- AnnotationsSection emit LOADED khi load xong, hover từ card cũng broadcast → bidirectional cross-highlight
- API GET annotations return `selectionRect`; POST đã accept từ trước

## ✅ Phase 4 Step 4 — SHIPPED 2026-05-27 (Saved-search notify cron)

- `inngest/functions/library-saved-search-notify.ts` cron `0 14 * * *` (21:00 VN)
- Filter library_doc theo PARAM_TO_COL mapping (subject/level/grade/docType/language/fileFormat/difficulty) + `created_at > last_run_at`
- Expo Push API batch 100 token/req, 1 push per matched saved-search (multi-device fan-out), insert notification_log dedupe key (user × savedSearch)
- Update `last_run_at = NOW()` cho TẤT CẢ saved-search có notify (kể cả không match) — windowing chuẩn
- Cleanup invalid Expo tokens (DeviceNotRegistered) idempotent
- Note: `q` FTS text search skip ở cron scale, Phase 5 sẽ thêm tsvector match

## ✅ Phase 4 Step 5 — SHIPPED 2026-05-27 (Subscription PRO + paid premium docs)

- Migration 0052 — `library_doc_purchase` table (unique doc × buyer) + `user.pro_until_at`
- `lib/library/access.ts` — `checkDocAccess(docId, userId)` + `isUserPro(userId)` central gate (free/owner/pro/purchased states)
- `lib/tutoring/wallet.ts` — thêm `creditWallet()` cho payout PAYOUT_RECEIVED; thêm `LIBRARY_PURCHASE` + `PRO_SUBSCRIPTION` txn types
- `karma.ts` — thêm `premium_sale` event (+10 points)
- `POST /api/library/docs/[id]/purchase` — chargeWallet buyer → creditWallet creator (creatorSharePct snapshot) → insert purchase row → award karma. Idempotent qua unique index. PRO branch free + ghi purchase 0đ.
- `POST /api/library/subscribe-pro` — charge 199K × months → user.plan='PRO' + extend proUntilAt (stack nếu còn hạn, reset nếu hết).
- `inngest/functions/library-pro-downgrade.ts` cron `0 3 * * *` (10:00 VN) — UPDATE plan='FREE' WHERE plan='PRO' AND proUntilAt < NOW().
- Gate `/api/library/docs/[id]/file` GET + `/import` POST → 402 nếu premium chưa mua.
- UI: `PremiumLockedPreview` (blurred backdrop + giá + CTA), `PremiumPurchaseButton` (loading + 402 toast), `/library/pro` landing + `SubscribeProForm` 4 preset (1/3/6/12 tháng).
- Detail page server-side `checkDocAccess()` → render locked preview thay vì DocPreviewPanel khi premium chưa unlock; ImportToWorkspaceButton disabled + premium label.

## ✅ Phase 4 Step 5 finishing touches — SHIPPED 2026-05-27

- `/api/library/docs/[id]/download` GET cũng gate qua `checkDocAccess` → 402 nếu premium chưa mua
- `DocCard` thumbnail thêm Premium chip 🔒 + price overlay khi `isPremium && priceVnd>0`
- `HubCuratedSections` mini card thêm Premium chip overlay bottom-right
- `hybrid-search-doc.ts` select + map `isPremium` + `priceVnd` để consumer hub có data
- `LibraryGrid` map 2 trường mới sang `DocCardData`
- Library hub header: nút "Nâng cấp PRO" (gradient violet) cho non-PRO, "PRO active" outline amber khi đang PRO _(cập nhật 2026-05-28: gỡ nút upsell cho non-PRO — chỉ giữ chip "PRO active" cho subscriber; upsell non-PRO do banner dưới search lo, hết trùng 2 CTA)_
- Library hub strip CTA dưới search bar (chỉ hiển thị FREE user, ẩn khi đang search active)

Phase 4 còn lại (Phase 5+):

- Mobile voice Q&A
- Live study room realtime
- Saved-search FTS query (`q` text matching trong cron)
- Pre-emptive PRO expiry notif (3 ngày trước hết hạn → upsell renewal)
- Refund pro-rated khi cancel PRO sớm
- Phase 5 mega-features per master plan

---

## ✅ Phase 5 — SHIPPED 2026-05-27

Gói Polish + tiện ích + Voice Q&A. P5.4 Live study room SKIP vì project đã có `room` + `studyGroup` (Stage 2 M5/V2 G) — wiring riêng cho library sẽ defer thành integration phase sau.

### P5.1a — Saved-search FTS `q` query trong cron

- [library-saved-search-notify.ts](apps/web/src/inngest/functions/library-saved-search-notify.ts) — khi `queryParams.q` có ≥2 ký tự, predicate `library_doc.search_vec @@ plainto_tsquery('simple', q)` (raw SQL — search_vec là generated column chưa map qua Drizzle schema)

### P5.1b — Pre-emptive PRO expiry warn cron

- [library-pro-expiry-warn.ts](apps/web/src/inngest/functions/library-pro-expiry-warn.ts) cron `0 9 * * *` (16:00 VN)
- Scan user PRO có `pro_until_at` trong [NOW+2d, NOW+4d] → push warn
- Dedupe qua notification_log type='pro-expiry-warn' window 7 ngày

### P5.1c — Cancel PRO + refund pro-rated

- [cancel-pro endpoint](apps/web/src/app/api/library/cancel-pro/route.ts) — tính prorate `(remainingDays/30 × 199K)`, cap theo tổng đã charge PRO_SUBSCRIPTION 90 ngày qua, refundToWallet + flip plan='FREE', set proUntilAt=NOW idempotent
- UI [CancelProButton](apps/web/src/components/library/cancel-pro-button.tsx) — ConfirmDialog hiển thị refund estimate trước khi confirm

### P5.2a — Noto font cho pdfjs thumbnail

- [generate-real-pdf-thumbnails.ts](apps/web/scripts/generate-real-pdf-thumbnails.ts) + [parsers.ts](apps/web/src/lib/library/parsers.ts) pass `docInitParams: { verbosity: 0, disableFontFace: true, useSystemFonts: false }` → tắt LiberationSans fallback warning noise (PDF đã embed Noto Sans qua pdf-lib trong Phase 4 Step 2)

### P5.2b — DOCX inline viewer qua Office Online iframe

- [DocxPreview](apps/web/src/components/library/doc-preview-panel.tsx) — fetch presigned URL từ /download → embed `https://view.officeapps.live.com/op/embed.aspx?src=...` iframe 700px
- Fallback nếu iframe error: thumb + nút "Mở DOCX trong tab mới"
- Sandbox `allow-scripts allow-same-origin allow-popups allow-forms` để Office Online render được

### P5.3 — Mobile voice Q&A backend + web demo

- [voice-search endpoint](apps/web/src/app/api/library/voice-search/route.ts) — multipart audio (max 25MB) → Groq/OpenAI Whisper (verbose_json, language vi default) → crossDocSearch top 5 chunk hits → JSON { transcript, language, hits, quota }
- Rate limit 30 voice search/giờ/user qua notification_log audit table (type='library-voice-search-quota'). Phase 6 sẽ chuyển Redis.
- Web demo [/library/voice](<apps/web/src/app/(app)/library/voice/page.tsx>) + [VoiceSearchClient](apps/web/src/components/library/voice-search-client.tsx) — MediaRecorder mic → Blob upload → hiển thị transcript + top hit cards

### P5.4 Live study room — SKIP

Existing `room` table ([schema.ts:1504](packages/db/src/schema.ts#L1504)) đã có LiveKit room name + features (video/chat/whiteboard/notes/aiTutor/recording) + members; `studyGroup` cũng có channels/invite. Live study room cho library sẽ là integration nhỏ (add `room.attachedLibraryDocId` cột + attach/detach endpoint + UI render PDF inline trong room view + LiveKit data channel broadcast scroll position). Defer khi user pull-request riêng.

**Phase 5 metrics**: 6 file mới (3 endpoint, 2 cron, 1 web demo page + 1 UI client) + 2 file edit (parsers + docx viewer). Typecheck PASS. No new migration.

Phase 6+ candidates:

- LLM answer summary cho voice search (Groq Llama 3.3 70B với hits context)
- Mobile native app integration (cùng endpoint, AVAudioRecorder iOS / MediaRecorder Android)
- Redis sliding window rate limit
- Live study room library doc integration (room.attachedLibraryDocId)

Format-specific processing pipeline:

- **PDF**: pdf.js text extract per page + sharp thumbnail (đã có pattern)
- **DOCX**: mammoth.js convert → HTML/text → tách paragraph thành chunk + first-page PDF render cho thumbnail
- **Image (PNG/JPG)**: GPT-4o vision OCR + extract text → single-chunk doc + image direct as thumbnail

---

## ✅ University→Course model + Hub discovery/grid mode — SHIPPED 2026-05-28

Pivot taxonomy giống trang lớn (Studocu/CourseHero): **University → Course → Doc** thay vì subject phẳng. UGC tạo course tự do, university là coupling tuỳ chọn.

### Schema + data

- Migration `0053_library_university_course.sql` — bảng `library_university` + `library_course`; thêm cột `library_doc.course_id / university_id / course_name_cache`; regenerate `search_vec` thêm `course_name_cache` (weight A).
- Seed: 7 trường (HUST/VNU-UET/NEU/FTU/UMP/HLU/UIT) + 15 course; 34 doc nội dung học thuật THẬT (fixtures `real-doc-content.ts` + `university-docs.ts`), render qua `scripts/lib/pdf-render.ts` (cover + heading/đoạn/bullet/công thức/code). Thumbnail lấy **trang 2 (nội dung)** không phải trang bìa.

### Routing + API

- Landing pages `/library/university/[id]` + `/library/course/[id]` (header + breadcrumb + LibraryGrid scoped).
- API `/api/library/universities` + `/courses` (GET search + POST create-on-the-fly slug dedup); `course-picker.tsx` 2 combobox autocomplete + create. `docs/finalize` nhận `courseId` → resolve university_id/courseNameCache.
- `hybrid-search-doc.ts` thêm filter `universityId`/`courseId` + project `courseNameCache`. DocCard hiện course chip (lucide `GraduationCap`, không emoji).

### Hub discovery vs grid mode (pattern trang lớn)

- Trang `/library` mặc định = **discovery**: feed thuần carousel, giống Studocu/CourseHero home. **KHÔNG đổ full grid**, **KHÔNG hàng pill browse**.
- Carousel ([hub-curated-sections.tsx](apps/web/src/components/library/hub-curated-sections.tsx)) refactor 2026-05-28. **Nguyên tắc: carousel chỉ dành cho curation mà sort KHÔNG cho được** (hành vi + cá nhân hoá). Còn: **Đọc tiếp** (RecentlyViewed, hành vi) · **Dành cho bạn** (content-based: gom môn từ lịch sử view+import → gợi ý doc cùng môn user chưa xem; chỉ hiện khi có signal; KHÔNG See-all). Cold-start (chưa signal / chưa login) → fallback **Phổ biến** (→`?sort=popular`) để feed không rỗng.
- Gỡ row **"Outcome Verified" + "Top Quality"** (trùng nhau, See-all sai ngữ cảnh) và **"Thịnh hành"/"Mới nhất"** làm row mặc định (chỉ là cách sort — đã có trong dropdown sort của grid, không phải curation). i18n gỡ key `curated.verified/top_quality/newest`.
- Browse theo trường/môn = **directory kiểu Studocu** (dropdown chật chội đã bỏ). Nút **"Khám phá"** header → [/library/universities](<apps/web/src/app/(app)/library/universities/page.tsx>): [BrowseDirectory](apps/web/src/components/library/browse-directory.tsx) (client) — search lọc real-time + grid card trường (avatar chữ cái màu + N môn · M tài liệu) + grid môn chung (`university_id IS NULL`).
- Trang trường [/library/university/[id]](<apps/web/src/app/(app)/library/university/[id]/page.tsx>) nâng kiểu Studocu: breadcrumb (Thư viện / Khám phá / trường) + header + 2 cột [main: [UniversityCourseBrowser](apps/web/src/components/library/university-course-browser.tsx) — search môn + tab Phổ biến/A-Z (chỉ render letter thật có môn) + grid folder card] và [sidebar "Danh mục nội dung" — tổng doc + breakdown theo `doc_type`]. Học phần ĐH truy cập qua drill-down trường; click môn → trang môn.
- **Grid mode** (full danh sách + filter + phân trang) chỉ bật khi: search/lọc (`hasActiveSearch`), bấm "See all" carousel (`?sort=...`), hoặc click môn (→ trang môn). KHÔNG có CTA "browse all" lủng lẳng ở đáy — filter là toolbar gắn vào trang kết quả.
- PRO banner gate theo `isDiscovery`.

### Search "chuẩn hiện đại" (doc-level grid) 2026-05-28

- [hybrid-search-doc.ts](apps/web/src/lib/library/hybrid-search-doc.ts): grid search = **FTS có trọng số (title/course=A) xếp theo `ts_rank` DESC + relative floor** (giữ `rank ≥ max*0.02`, cắt đuôi nhiễu) + **diacritic-insensitive** (unaccent — gõ "giai tich" vẫn ra "Giải tích").
- **Bỏ vector RRF** (bug cũ: `FULL OUTER JOIN` gộp mọi doc có embedding + vector ghi đè FTS → "giải tích" ra "Vợ chồng A Phủ", `total` luôn=34). **Quyết định data-driven**: backfill đủ 34/34 `title_embedding` rồi probe — voyage-3 gần như vô tín hiệu với content VN (distance dồn cục 0.63-0.73, "giải tích" xếp "Vợ chồng A Phủ" gần hơn "Giải tích 1"). Vector ở grid hại > lợi → loại. (Đừng re-add trừ khi đổi embedding model + verify lại.)
- Migration `0054_library_search_unaccent.sql`: `CREATE EXTENSION unaccent` + wrapper `immutable_unaccent()` (IMMUTABLE, dict tường minh) → regen `search_vec` GENERATED bọc unaccent quanh mọi field. Query (grid + [saved-search cron](apps/web/src/inngest/functions/library-saved-search-notify.ts)) cũng `immutable_unaccent` để 2 phía khớp.
- Backfill: [backfill-embeddings.ts](apps/web/scripts/backfill-embeddings.ts) — set title_embedding cho doc seed (dùng cho dedup/cross-doc, KHÔNG cho grid search). Chunks defer: text PDF có NUL byte (0x00) + pdfjs version mismatch (API 5.6 vs worker 4.10) → insert lỗi; cần sanitize ` ` + fix pdfjs version nếu muốn cross-doc/voice trên doc seed.
- Verify: có dấu/không dấu/HOA cho cùng kết quả; query rác → 0 (không đổ toàn bộ). Semantic chunk-level vẫn ở luồng reverse/voice (content_vec riêng).

### Fix kèm theo (ingest + goal) 2026-05-28

- **NUL byte → ingest fail**: [parsers.ts](apps/web/src/lib/library/parsers.ts) `parsePdf` strip control char `\p{Cc}` — pdfjs đôi khi trả 0x00 cho glyph lỗi → Postgres từ chối → chunk insert throw → `ingestLibraryDoc` throw → **upload thật kẹt PROCESSING**. Sửa rồi (dùng `\p{Cc}` thay control-char regex để tránh lint `no-control-regex`).
- **Goal planning failed**: refactor FTS nối các mảnh `filterSql` dính liền không khoảng trắng → `tp.level = $3AND ...` → Postgres "trailing junk after parameter". Chỉ lộ khi search CÓ filter (goal mode / text+filter); search không filter thì các mảnh rỗng nên không lỗi. Fix: thêm newline giữa các mảnh trong [hybrid-search-doc.ts](apps/web/src/lib/library/hybrid-search-doc.ts).
- **parseGoal luôn fallback**: LLM trả `null` cho field optional (grade/score/hoursPerWeek) → Zod `.optional()` từ chối null → catch → fallback generic (math). Fix [goal-planner.ts](apps/web/src/lib/library/goal-planner.ts): strip key null trước `GOAL_SCHEMA.parse` → goal parse đúng subject/level/deadline thật.
- **Goal: mọi tuần "0 tài liệu"**: goal planner ghép cụm topic thành 1 query rồi search AND mọi token → ~0 doc khớp đủ; thêm hard-filter level/grade (LLM hay parse sai) loại nốt. Fix: thêm `matchMode: 'or'` vào `hybridSearchLibraryDocs` (OR token, ts_rank vẫn rank doc khớp nhiều token lên đầu + floor cắt nhiễu) + goal chỉ filter `subjectSlug`+`language` (bỏ level/grade vì recommendation ưu tiên recall). Sau fix: mỗi tuần có LT/BT/ĐT, Giải tích 1 HUST xuất hiện. (Lặp doc giữa các tuần là do catalog nhỏ ~6 doc Toán; tự cải thiện khi nhiều doc hơn.)
- **Pending (cosmetic)**: `pdf-to-img@6.1.0` cần `pdfjs-dist ~5.6.205` nhưng app pin `^4.10.38` → API/Worker lệch → thumbnail rớt placeholder (doc vẫn publish + search). Fix dứt = nâng pdfjs-dist 4→5 + reinstall + verify render.

### Bulk content — thư viện lớn từ Wikipedia VN THẬT 2026-05-28

- Mục tiêu: 1000-2000 doc đa dạng. Nguồn = **Wikipedia tiếng Việt (CC-BY-SA, có attribution)** — nội dung THẬT, hợp pháp, không scrape doc bản quyền (SGK/Studocu = vi phạm).
- [scripts/lib/wiki.ts](apps/web/scripts/lib/wiki.ts): fetch article (extracts plaintext) + category members (recurse subcat 1 cấp) + retry/backoff rate-limit + `articleToBlocks` (heading/đoạn + block attribution).
- [scripts/fixtures/wiki-sources.ts](apps/web/scripts/fixtures/wiki-sources.ts): ~33 nguồn = category/seed → university/course/subject/level. Mở rộng tự động qua category → đủ volume.
- [scripts/seed-bulk-docs.ts](apps/web/scripts/seed-bulk-docs.ts): fetch→render PDF (pdf-render lib)→thumbnail (pdf-to-img chạy OK trong seeder)→upload R2→insert `library_doc` PUBLISHED. **KHÔNG embed/LLM** (không có provider trả phí + embed vô dụng cho grid FTS). Resumable (skip theo title), `--limit/--per-source/--cat-limit`, recompute doc_count.
- Search trên bulk docs: **FTS-only đầy đủ** — Tìm tự do + Mục tiêu (study plan) + Browse + filter/sort chạy 100% (search_vec auto + unaccent). **Upload-đề (reverse) + Voice** cần vector chunk → KHÔNG phủ bulk (chờ provider embed trả phí → 1 lệnh backfill là xong).
- Validation: 46 doc (34→46), 46/46 thumbnail thật, search "dinh thuc"→"Định thức" OK. Full run ~2000 đang chạy nền.

### UI/UX polish pass 2026-05-28 (audit 3 agent → fix nhóm tác động rộng)

- **Zero-state** (3000+ doc seed stats=0): detail page thay lưới "–/0/0" bằng 1 dòng "✨ Tài liệu mới · chưa có lượt tương tác" khi chưa có engagement; CuratedCard thêm badge "Mới" khi chưa có Q-score (đồng bộ DocCard); hub ẩn "lượt thêm" khi tổng=0.
- **a11y**: mọi thumbnail card `alt=""`→`alt={title}`; focus-visible ring cho 5 component card (doc-card, hub-curated, recently-viewed, browse-directory, university-course-browser).
- **i18n shared** (hiện trên MỌI list, bug khi đổi EN): [pagination.tsx](apps/web/src/components/tutoring/pagination.tsx) + [list-toolbar.tsx](apps/web/src/components/tutoring/list-toolbar.tsx) wire `useT()` (Sắp xếp/Lọc/Bỏ tất cả/Hiển thị/Mỗi trang/Tới trang/Trước/Sau); [library-grid.tsx](apps/web/src/components/library/library-grid.tsx) sort options + title + doctype filter chips dùng i18n. Thêm `common.*` keys (sort/filter/clear_all/showing/of/per_page/...).
- **Empty state**: trang "Của tôi" nâng lên `EmptyState` (icon + CTA button) thay text trơn.
- **remix page** i18n (back/title/desc) qua getServerT.
- i18n parity ver: mọi key xuất hiện đúng 2 lần (vi+en). Typecheck PASS.

### i18n

- Full Library i18n (~540 key × vi+en) qua `useT()`/`getServerT()` đọc cookie `cogniva.locale`.

### Đã gỡ

- **Atom Graph** — gỡ hoàn toàn (UX rối khi nhiều atom).

### Còn tồn (chưa fix)

- **PDF tofu □**: ký hiệu toán `→ ∫ √ ≤ ≥ ≈ ≠ ⟺ ∞` render thành ô vuông vì NotoSans-Regular.ttf thiếu glyph (xác nhận qua `scripts/probe-font.ts`). Hướng fix: sanitize content sang ASCII (`→`→`->`, `≤`→`<=`, `√`→`sqrt`…) hoặc embed font có math (DejaVu) rồi regenerate PDF + thumbnail.
