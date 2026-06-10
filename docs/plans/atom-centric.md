# Atom-centric Re-architecture — Cogniva V4

> **Mục tiêu:** Chuyển Cogniva từ "feature-centric" (mỗi feature 1 bảng + 1 trang
> rời rạc) sang "atom-centric" — mỗi đơn vị kiến thức là 1 atom, và Flashcard /
> Quiz / Exam / Graph / Study Plan / AI Tutor đều là **view** của atom đó.
>
> **Tác giả nguyên gốc:** chủ dự án (2026-05-20). Audit xác nhận: schema hiện
> tại đã có 80% nguyên liệu (`concept`, `mastery`, `chunkConcept`) nhưng wiring
> bị đứt ở 2 chỗ: flashcard không link concept, exam attempt không update
> mastery. Refactor có thể "kết nối" thay vì rewrite.

---

## 📑 Mục lục

- [1. Vấn đề (Problem)](#1-vấn-đề-problem)
- [2. Triết lý mới (Atom-centric)](#2-triết-lý-mới-atom-centric)
- [3. Schema target](#3-schema-target)
- [4. Mỗi feature là view nào của atom](#4-mỗi-feature-là-view-nào-của-atom)
- [5. UI changes](#5-ui-changes)
- [6. Migration plan (phase by phase)](#6-migration-plan-phase-by-phase)
- [7. Effort estimate](#7-effort-estimate)
- [8. Open questions](#8-open-questions)
- [9. Non-goals](#9-non-goals)

---

## 1. Vấn đề (Problem)

### 1.1. Diagnosis của user (2026-05-20)

> "Bạn đang design theo feature, không phải theo kiến thức. Nên mới rời rạc.
> Mỗi thứ trong app — Flashcard, Quiz, Exam, AI Tutor, Knowledge Graph,
> Study Plan — đang là 1 trang riêng, 1 database riêng, 1 flow riêng. User
> phải tự kết nối chúng trong đầu."

### 1.2. Audit xác nhận (đọc schema + route 2026-05-20)

**Bảng `concept` đã có** ở [packages/db/src/schema.ts:443](../../packages/db/src/schema.ts#L443):

```sql
concept (id, workspace_id, name, description, domain, embedding vector(1024))
```

→ Đây CHÍNH là atom theo nghĩa của user, chỉ thiếu vài field (examples,
preview Q/A) và **chưa được wire vào flashcard**.

**Wiring matrix hiện tại:**

| Feature | Bảng | Link tới concept | Update mastery? |
|---------|------|------------------|-----------------|
| Flashcard | `flashcard.conceptId` | nullable — **luôn NULL khi generate** ❌ | ❌ Không gọi `applyAttempt` |
| Quiz question | `question.conceptId` | populated từ `chunkConcept` pivot ✅ | ✅ `quiz/[id]/attempt` gọi `applyAttempt` |
| Exam question | `examQuestion.conceptId` | populated ✅ | ❌ Attempt submit không gọi |
| Knowledge graph | `concept` + `conceptRelation` | native ✅ | N/A (read-only) |
| Study plan | `studyPlanItem.conceptId` | nullable — rarely set ❌ | N/A |
| AI Tutor (chat) | retrieval qua `chunk` | không qua concept ❌ | N/A |

→ Quiz là feature **duy nhất** chạy đúng atom-centric. Còn lại đứt 1 hoặc cả 2
đầu.

### 1.3. Hệ quả UX (như user mô tả)

1. Workspace "Hệ phân tán": 4 PDF, 0 flashcard, 0 quiz. User phải bấm "AI
   generate" **3 lần riêng** cho 3 feature.
2. AI Tutor (`/chat`) yêu cầu manual pin PDF — user phải tự nói "tôi đang đọc
   atom X".
3. Study Plan (`/study-plan`) là Notion-lite trống — user không biết plan gì.
4. Knowledge Graph (`/graph`) chỉ là topology — không biết user đã master atom
   nào.
5. User trả lời sai flashcard → không ảnh hưởng gì tới quiz/graph/plan ngày
   mai.

### 1.4. Verdict

**Không cần rewrite database.** Cốt lõi đã có (`concept` ≈ atom, `mastery`,
`chunkConcept`). Cần:

- **Connect:** Populate `flashcard.conceptId`, wire mastery update từ
  flashcard + exam
- **Relabel:** Đổi mental model "concept = graph node" → "concept = atom =
  shared unit"
- **Remap UI:** Gộp Flashcard/Quiz/Exam thành 1 tab "Practice" trong
  workspace; AI Tutor thành slide-out; Study Plan auto-generated

---

## 2. Triết lý mới (Atom-centric)

### 2.1. Atom là gì

Một **atom kiến thức** = đơn vị nhỏ nhất có thể học độc lập, gồm:

- **Title** — tên ngắn ("Lamport timestamp", "MapReduce shuffle phase")
- **Definition** — 1-2 câu giải thích cốt lõi
- **Examples** — 1-3 ví dụ cụ thể (optional)
- **Source** — chunk(s) trong document(s) atom được extract từ
- **Difficulty estimate** — 0-1 (LLM estimate khi extract)
- **Embedding** — vector(1024) cho similarity search
- **Domain** — phân loại (CS / Math / Bio / …) cho graph clustering

→ Tương đương `concept` table hiện tại + thêm vài field.

### 2.2. Mọi feature là view của atom

```
┌──────────────────────────────────────────────────────────────┐
│                       ATOM (shared unit)                     │
│  id, title, definition, examples[], source_chunks[], ...     │
└──────────────────────────────────────────────────────────────┘
       │              │              │              │
       ▼              ▼              ▼              ▼
  ┌────────┐    ┌────────┐    ┌────────┐    ┌──────────┐
  │Flashcard│   │ Quiz   │    │ Exam   │    │ Graph    │
  │ Q/A     │   │ MCQ    │    │ MCQ +  │    │ node +   │
  │ render  │   │ render │    │ short  │    │ edges    │
  └────────┘    └────────┘    └────────┘    └──────────┘
       │              │              │              │
       └──────────────┴──────────────┴──────────────┘
                      │
                      ▼
              ┌─────────────┐
              │  mastery    │ ← 1 row / (user × atom)
              │  BKT score  │   update từ MỌI feature
              │  fsrs state │
              └─────────────┘
                      │
       ┌──────────────┴──────────────┐
       ▼                             ▼
  ┌──────────┐                  ┌──────────┐
  │Study Plan│                  │AI Tutor  │
  │auto-pick │                  │context = │
  │atom yếu  │                  │atom user │
  │+ SRS due │                  │đang xem  │
  └──────────┘                  └──────────┘
```

### 2.3. Cross-feature state propagation

User trả lời sai 1 atom ở flashcard → 1 lần `applyAttempt(user, atom, 0)`:

- Mastery score giảm → BKT update
- Atom "due" cho review sớm hơn (SRS interval reset)
- Graph node của atom đổi sang màu vàng (đang học)
- Study Plan ngày mai chèn atom đó vào top
- AI Tutor next open biết "user đang yếu atom này"
- Quiz tuần này có MCQ atom đó với probability cao hơn

→ **1 event, mọi view tự cập nhật**. Đó là điểm khác biệt với hệ thống hiện
tại.

---

## 3. Schema target

### 3.1. Quyết định naming

Hai option:

- **A. Giữ tên `concept`**, chỉ thêm field thiếu + fix wiring. Migration nhẹ.
- **B. Rename `concept` → `atom`** xuyên suốt code. Clearer nhưng phải đổi
  ~50 file (route, component, type, comment).

**Quyết định: Option A** — giữ `concept`. Lý do:
- Quiz/exam/graph code đã quen với `conceptId`. Đổi tên không cải thiện
  function, chỉ đẹp.
- Trong UI **show "atom"** cho user (label), nhưng DB giữ `concept`. Đây là
  tách layer khái niệm vs schema.
- Tương lai nếu muốn rename → migration 1 line `ALTER TABLE … RENAME TO …`.

### 3.2. Migration 0031 — extend concept

```sql
-- Thêm field cho concept để "lên cấp" thành atom đầy đủ.
ALTER TABLE concept
  ADD COLUMN examples jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN difficulty real,  -- 0..1, LLM estimate khi extract
  ADD COLUMN preview_question text,  -- Q ngắn để hiển thị "này là gì?"
  ADD COLUMN preview_answer text;

-- Index cho difficulty (study plan: pick atom hard mà mastery thấp)
CREATE INDEX concept_difficulty_idx ON concept (difficulty);
```

### 3.3. Migration 0032 — link flashcard ↔ concept

```sql
-- flashcard.concept_id đã tồn tại nullable. Migration data:
-- với mỗi flashcard chưa có conceptId, lookup qua source_chunk_id → chunkConcept
UPDATE flashcard f
SET concept_id = cc.concept_id
FROM chunk_concept cc
WHERE f.source_chunk_id = cc.chunk_id
  AND f.concept_id IS NULL
  AND cc.strength = (
    SELECT MAX(strength)
    FROM chunk_concept
    WHERE chunk_id = f.source_chunk_id
  );

-- Forward-fix: index để query "flashcard của 1 atom"
CREATE INDEX flashcard_concept_user_idx ON flashcard (concept_id, user_id);
```

### 3.4. Migration 0033 — atom view + mastery extension

```sql
-- Atom mastery cần thêm fields cho cross-feature aggregation
ALTER TABLE mastery
  ADD COLUMN last_quiz_at timestamp,
  ADD COLUMN last_flashcard_at timestamp,
  ADD COLUMN last_exam_at timestamp,
  ADD COLUMN total_attempts int NOT NULL DEFAULT 0;

-- View để client query 1 lần lấy "atom + mastery + flashcard count"
CREATE VIEW atom_view AS
SELECT
  c.id, c.workspace_id, c.name, c.description, c.examples,
  c.difficulty, c.domain, c.embedding,
  m.score AS mastery_score,
  m.total_attempts,
  m.last_reviewed_at,
  (SELECT COUNT(*) FROM flashcard WHERE concept_id = c.id) AS flashcard_count,
  (SELECT COUNT(*) FROM question WHERE concept_id = c.id) AS quiz_count
FROM concept c
LEFT JOIN mastery m ON m.concept_id = c.id;
```

### 3.5. Cấu trúc bảng cuối cùng (target)

```
concept (= ATOM)
├── id
├── workspace_id
├── name (title)
├── description (definition)
├── examples jsonb[]          ← NEW
├── difficulty real           ← NEW
├── preview_question text     ← NEW
├── preview_answer text       ← NEW
├── domain
└── embedding vector(1024)

chunk_concept (pivot — provenance)
├── chunk_id
├── concept_id
└── strength

flashcard (= ATOM rendered as Q/A)
├── id
├── user_id
├── workspace_id
├── concept_id  ← REQUIRED khi generate mới (nullable cho legacy)
├── source_chunk_id
├── front, back, type
└── FSRS state (difficulty, stability, retrievability, due, lastReview)

question (= ATOM rendered as MCQ — đã hoàn chỉnh)
├── id
├── quiz_id
├── concept_id  ← đã populated
├── stem, choices, correctIndex, explanation
└── source_chunk_id

exam_question (= ATOM rendered as exam item — đã có concept_id)
├── id
├── exam_id
├── concept_id  ← đã populated
└── ...

mastery (= ATOM learning state)
├── user_id
├── concept_id  ← key per (user × atom)
├── score real (BKT)
├── last_reviewed_at
├── last_quiz_at, last_flashcard_at, last_exam_at  ← NEW
└── total_attempts                                  ← NEW

study_plan_item (= ATOM scheduled)
├── id
├── user_id
├── concept_id  ← populate đầy đủ (hiện tại rarely set)
├── due_date
├── type ('review' | 'new' | 'practice')
└── completed
```

---

## 4. Mỗi feature là view nào của atom

### 4.1. Flashcard

**Hiện tại:** Generate từ chunk text, lưu 1 flashcard với front/back. `conceptId`
NULL.

**Target:** Generate per atom, lưu flashcard với `conceptId` = atom đó.
1 atom có thể có nhiều flashcard (basic + cloze + reverse) — mỗi type là 1
"render" khác nhau của cùng atom.

**Pseudocode generate:**

```ts
// apps/web/src/lib/flashcards/generate.ts (sau refactor)
async function generateForDocument(docId: string, userId: string) {
  const chunks = await db.select().from(chunk).where(eq(chunk.documentId, docId));
  const atoms = await ensureAtomsForChunks(chunks);  // extract concept nếu chưa có

  for (const atom of atoms) {
    const card = await llm.generateBasicCard(atom);  // input: atom, không chunk
    await db.insert(flashcard).values({
      userId,
      conceptId: atom.id,            // ← REQUIRED
      sourceChunkId: atom.sourceChunks[0],
      front: card.q,
      back: card.a,
      type: 'BASIC',
    });
  }
}
```

**Review flow update:**

```ts
// apps/web/src/app/api/flashcards/[id]/review/route.ts
const card = await db.select().from(flashcard).where(eq(flashcard.id, id));
const next = fsrsSchedule(card, grade);
await db.update(flashcard).set({ ...next }).where(eq(flashcard.id, id));

// ← THÊM: update mastery nếu link concept
if (card.conceptId) {
  await applyAttempt(userId, card.conceptId, grade >= 3 ? 1 : 0);
}
```

### 4.2. Quiz

**Đã đúng atom-centric.** Không đổi. Chỉ verify:
- Question.conceptId luôn set khi generate ✅
- Attempt gọi `applyAttempt` ✅

### 4.3. Exam

**Wire mastery update:** Trong exam attempt submit handler, sau khi grade từng
question:

```ts
// apps/web/src/app/api/attempts/[id]/responses/route.ts (sau refactor)
for (const resp of responses) {
  const q = examQuestions.find(x => x.id === resp.questionId);
  if (q.conceptId) {
    await applyAttempt(userId, q.conceptId, resp.score / q.maxScore);
  }
}
```

### 4.4. Knowledge Graph

**Hiện tại:** Render node = concept, edge = conceptRelation. Không màu state.

**Target:** Mỗi node có 3 màu theo mastery:

| Mastery score | Màu | UI label |
|---------------|-----|----------|
| `>= 0.85` | 🟢 xanh | Đã master |
| `0.3 - 0.85` | 🟡 vàng | Đang học |
| `< 0.3` hoặc null | ⚪ xám | Chưa biết |

Click node xám → mở action sheet:
- "Học atom này 10 phút" → start Pomodoro session với flashcard + quiz + AI
  Tutor context pre-loaded
- "Show source" → mở doc preview tại chunk gốc

API: extend `/api/concepts/graph` trả thêm `mastery.score` cho mỗi node.

### 4.5. AI Tutor (Chat)

**Hiện tại:** `/chat` là page riêng. User pin PDF manual.

**Target:** Slide-out panel mở từ mọi nơi:
- Trang document: nút "Hỏi về đoạn này" → mở chat, auto-pin chunk hiện tại
- Trang flashcard: nút "Tại sao sai?" → mở chat với atom + câu trả lời sai
- Trang graph: click node → nút "Giải thích atom này" → chat pre-context atom
- Trang exam: nút "Giải thích đáp án" → chat với question + correct answer

**Implement:**
- Tạo component `<AiTutorPanel atomId={...} chunkId={...} />` — drawer từ phải
- Backend: `/api/chat` đã accept `workspaceId` + `documentIds` — extend thêm
  `atomIds[]` (concept-level scope) và `chunkIds[]` (chunk-level pin)
- Retrieval pipeline: nếu có `atomIds`, query chunks thuộc atom đó qua
  `chunkConcept` pivot

**`/chat` không xoá** — vẫn giữ làm "AI Tutor full page" cho ai thích.
Component slide-out chỉ là alternative entry point.

### 4.6. Study Plan

**Hiện tại:** Empty todo list, user tự gõ.

**Target:** AI-proposed. Mỗi ngày 1 query sinh ~5-10 item:

```ts
// apps/web/src/lib/study-plan/propose.ts (NEW)
async function proposeForToday(userId: string) {
  // 1. Atom due theo SRS (mastery.last_reviewed_at + interval)
  const dueAtoms = await db
    .select()
    .from(mastery)
    .where(and(
      eq(mastery.userId, userId),
      lt(mastery.nextReviewAt, new Date()),
    ))
    .orderBy(asc(mastery.score))   // yếu nhất trước
    .limit(5);

  // 2. Atom mới (chưa có mastery row) — chọn 1-2
  const newAtoms = await db
    .select()
    .from(concept)
    .leftJoin(mastery, and(
      eq(mastery.conceptId, concept.id),
      eq(mastery.userId, userId),
    ))
    .where(and(
      eq(concept.workspaceId, userActiveWorkspace),
      isNull(mastery.userId),
    ))
    .orderBy(asc(concept.difficulty))   // dễ trước
    .limit(2);

  // 3. Atom yếu nhất (mastery < 0.5) → quiz format
  const weakAtoms = await db.select().from(mastery)
    .where(and(eq(mastery.userId, userId), lt(mastery.score, 0.5)))
    .orderBy(asc(mastery.score))
    .limit(3);

  // 4. Insert vào study_plan_item với type + due_date hôm nay
  // 5. UI hiển thị → user accept hoặc swap
}
```

**UI:** Trang `/study-plan` đổi từ todo trống → list card AI đề xuất, user
swipe để accept / swap / skip. Empty state nói "AI đang chuẩn bị plan…"
thay vì textarea.

---

## 5. UI changes

### 5.1. Workspace tab gộp: "Practice"

**Hiện tại:** Workspace detail page có tabs `Docs | Notes | Flashcards | Quizzes | Exams`.

**Target:** `Docs | Notes | Practice | Atoms`

- **Practice** — 1 tab thay thế 3 tab cũ:
  - Top: "Hôm nay" card — 5 atom review (SRS due) + 1 atom mới + 3 quiz, 1
    button "Bắt đầu phiên 15 phút"
  - Section "Flashcard" — list filterable, expand 1 atom thấy tất cả flashcard
    + quiz item của atom đó
  - Section "Quiz" — list quiz sets
  - Section "Exam" — list exam (giữ nguyên vì exam ít hơn, có context riêng)
- **Atoms** — list atom + state. Click 1 atom thấy:
  - Definition + examples
  - Mastery score
  - Tất cả flashcard / quiz / exam item của atom đó
  - Nút "Học atom này 10 phút" → Pomodoro session

### 5.2. Workspace "Today" card

Trên top mỗi workspace detail (cả khi vào tab nào):

```
┌─────────────────────────────────────────────────────────┐
│  Hôm nay trong Hệ phân tán                              │
│                                                          │
│  📚 5 atom cần ôn (SRS due)                             │
│  ✨ 1 atom mới: "Lamport timestamp"                     │
│  📝 3 câu quiz                                          │
│                                                          │
│  Tổng: ~15 phút  [ Bắt đầu phiên ]  [ Tuỳ chỉnh ]      │
└─────────────────────────────────────────────────────────┘
```

Click "Bắt đầu phiên" → flow 15 phút:
1. 5 phút review flashcard atom due
2. 5 phút atom mới (đọc definition + 2 flashcard ngay)
3. 3 phút quiz check
4. 2 phút review kết quả + mastery update

### 5.3. AI Tutor slide-out

Component mới: `<AiTutorDrawer>` — render ở root layout `(app)/layout.tsx`,
toggle bằng:
- Phím tắt `Cmd/Ctrl + J`
- Nút floating "Hỏi AI" góc dưới phải khi đang ở document / flashcard /
  graph page
- Context tự pin theo URL pattern:
  - `/documents/[id]?#page-3` → pin chunk page 3
  - `/flashcards?atom=X` → pin atom X
  - `/graph?node=Y` → pin atom Y

### 5.4. Knowledge Graph state coloring

API extend (file mới hoặc patch existing `/api/concepts/graph`):

```ts
// Trả thêm: per-node mastery + count
return {
  nodes: concepts.map(c => ({
    id: c.id,
    label: c.name,
    domain: c.domain,
    mastery: masteryMap.get(c.id)?.score ?? null,  // ← NEW
    flashcardCount: counts.get(c.id)?.fc ?? 0,     // ← NEW
    quizCount: counts.get(c.id)?.qc ?? 0,          // ← NEW
  })),
  edges: relations,
};
```

UI map mastery → color trong [graph component]:

```ts
function nodeColor(mastery: number | null) {
  if (mastery === null) return '#94a3b8';      // slate-400 — chưa biết
  if (mastery >= 0.85) return '#10b981';        // emerald-500 — master
  if (mastery >= 0.3) return '#f59e0b';         // amber-500 — đang học
  return '#ef4444';                              // red-500 — yếu
}
```

### 5.5. Study Plan UI

Đổi `/study-plan` từ todo input → daily proposal:

```
Hôm nay (2026-05-21)

┌─────────────────────────────────────────────┐
│ ⏰ SRS Review (5 atoms, ~5 phút)             │
│   • Lamport timestamp                        │
│   • Vector clock                             │
│   • MapReduce shuffle                        │
│   …                                          │
│   [ Bắt đầu ]  [ Skip hôm nay ]             │
├─────────────────────────────────────────────┤
│ ✨ Atom mới (1, ~5 phút)                     │
│   • Raft consensus                           │
│   [ Học bây giờ ]  [ Đổi atom khác ]        │
├─────────────────────────────────────────────┤
│ 🎯 Quiz check (3 câu, ~3 phút)               │
│   Focus: atom yếu nhất tuần này              │
│   [ Bắt đầu ]                                │
└─────────────────────────────────────────────┘

▼ Tuần này
▼ Tháng này (high-level)
```

---

## 6. Migration plan (phase by phase)

### Phase A — Backend wiring (~2-3 ngày, không touch UI) — ✅ SHIPPED 2026-05-20

**A1.** ✅ Migration 0031 — thêm field `concept.examples / difficulty / preview_q / preview_a`
**A2.** ✅ Migration 0032 — populate `flashcard.concept_id` từ `chunk_concept` cho rows cũ + backfill mastery theo FSRS heuristic (REVIEW=0.7, LEARNING=0.3, RELEARNING=0.2, NEW=0)
**A3.** ✅ Migration 0033 — mastery `last_quiz_at` / `last_flashcard_at` / `last_exam_at`
**A4.** ✅ Update [flashcards/generate/route.ts](../../apps/web/src/app/api/flashcards/generate/route.ts) — set `conceptId` qua `chunkConcept` lookup (strongest strength match)
**A5.** ✅ Update [flashcards/[id]/review/route.ts](../../apps/web/src/app/api/flashcards/[id]/review/route.ts) — gọi `applyAttempt(userId, conceptId, obsScore, 'flashcard')` map rating 1-4 → 0/0.4/0.8/1.0
**A6.** ✅ Update [attempts/[id]/submit/route.ts](../../apps/web/src/app/api/attempts/[id]/submit/route.ts) — wire `applyAttempt` per response với obsScore = pointsEarned/maxPoints
**A7.** ✅ Update [lib/concepts/extract.ts](../../apps/web/src/lib/concepts/extract.ts) — LLM prompt sinh KÈM `examples` / `difficulty` / `previewQuestion` / `previewAnswer`. Sanitize forward-compat (cache cũ thiếu fields vẫn parse OK)
**A8.** ✅ Tạo [lib/atoms/get-atom.ts](../../apps/web/src/lib/atoms/get-atom.ts) — `getAtomView(atomId, userId)` parallel 4 query
**A9.** ✅ Tạo [/api/atoms/[id]](../../apps/web/src/app/api/atoms/[id]/route.ts) GET — return AtomView cho UI
**A10.** ✅ Async Inngest: event `document/ingested` + function `extract-document-concepts` ([extract-document-concepts.ts](../../apps/web/src/inngest/functions/extract-document-concepts.ts)) thay thế fire-and-forget. Inngest retry 3× exponential + concurrency 2 + backfill flashcard.conceptId sau khi extract xong (anti race với user gen flashcard sớm)
**A11.** ✅ Update [lib/mastery/update.ts](../../apps/web/src/lib/mastery/update.ts) — `applyAttempt` thêm param `source: 'quiz' | 'flashcard' | 'exam'`, set timestamp tương ứng

**Verify:**
- Migration 0032 chạy → 15 flashcard cũ populated conceptId, 2 mastery rows backfilled
- Typecheck: `@cogniva/db` + `@cogniva/web` đều pass
- Manual test cần làm sau: upload PDF mới → wait worker BullMQ extract atom → bấm gen flashcard → review sai → check `SELECT * FROM mastery WHERE user_id=...`

**Deferred (out of Phase A scope):**
- Replay flashcard review history retroactive (decision: heuristic-only đủ cho backfill)
- Concurrency lock chống race khi 5 quiz cùng concept đồng thời (chấp nhận overwrite Phase A; lock optional Phase F)
- Update existing concept fields khi extract gặp existing match (Phase A: chỉ populate khi INSERT mới, existing concept giữ nguyên)

### Phase B — Today + Study Plan AI (~3 ngày) — ✅ SHIPPED 2026-05-20

**B0.** ✅ Migration 0034 — studyPlanItem `kind` enum (`manual` / `review` / `new` / `practice`) + `metadata` jsonb + status `SKIPPED` enum value. Rows cũ tự classify `manual`, không phá UI legacy.
**B1.** ✅ [lib/study-plan/propose.ts](../../apps/web/src/lib/study-plan/propose.ts) — `proposeForToday(userId, workspaceId?)` parallel 3 query: (1) atom có flashcard `due ≤ NOW()` group concept GROUP BY concept_id, (2) concept linked với chunk của user nhưng chưa có mastery row, (3) mastery score < 0.5 có ≥ 1 question.
**B2.** ✅ [lib/study-plan/materialize.ts](../../apps/web/src/lib/study-plan/materialize.ts) — idempotent: check `WHERE created_at >= startOfDay AND kind != 'manual'`, nếu rỗng → INSERT items với kind + dueDate=today + metadata (estimatedMinutes, masteryScore, preview Q/A).
**B3.** ✅ [/study-plan/page.tsx](../../apps/web/src/app/(app)/study-plan/page.tsx) rewrite: hero band đếm proposal + estimated minutes, 3 section atom (Ôn / Mới / Quiz) màu emerald/blue/amber, mỗi card có "Bắt đầu" (link kind-appropriate) + "Bỏ qua hôm nay" (skip). Section "Todo cá nhân" giữ logic cũ ở dưới.
**B4.** ✅ [components/workspaces/today-card.tsx](../../apps/web/src/components/workspaces/today-card.tsx) + wire vào [workspace-detail-client.tsx](../../apps/web/src/components/workspaces/workspace-detail-client.tsx) — chip preview 3 nhóm + "Bắt đầu phiên" button link `/study-plan`. KHÔNG materialize (preview only).
**B5.** ✅ [/api/workspaces/[id]/today](../../apps/web/src/app/api/workspaces/[id]/today/route.ts) — `proposeForToday(userId, workspaceId)`.
**B6.** ✅ [/api/study-plan/today](../../apps/web/src/app/api/study-plan/today/route.ts) — GET trigger materialize + return items.
**B7.** ✅ [/api/study-plan/[id]/skip](../../apps/web/src/app/api/study-plan/[id]/skip/route.ts) — POST mark SKIPPED (kind != manual only).
**B8.** ✅ [/api/study-plan](../../apps/web/src/app/api/study-plan/route.ts) — extend GET query param `?kind=manual|review|new|practice` để page filter.

**Verify:**
- Migration 0034 applied: `study_plan_status` enum thêm SKIPPED, `study_plan_kind` enum created, `study_plan_item.kind/metadata` columns
- Typecheck: `@cogniva/db` + `@cogniva/web` đều pass
- Manual test cần làm sau: upload PDF → đợi worker BullMQ extract atom → vào `/study-plan` thấy 3 section (review trống nếu chưa có flashcard due, new section show 1-2 atom đầu)

**Deferred Phase B+:**
- Auto-regenerate alternative khi user skip (V1 chỉ mark SKIPPED, không gen replacement)
- Cron daily background materialize (V1 on-demand khi user mở page lần đầu)
- Timezone-aware todayRange (V1 dùng server tz — OK cho VN user)
- Workspace-scoped accept (UI workspace TodayCard hiện chỉ link `/study-plan` global, chưa filter scope)

### Phase C — Practice tab gộp (~2 ngày) — ✅ SHIPPED 2026-05-20

**C1.** ✅ Workspace detail page (`/workspaces/[id]`) — bỏ 3 tab Flashcards / Quizzes / Exams, gộp thành 1 tab "Practice" + bookmark URL cũ `?tab=flashcards|quizzes|exams` tự alias về `practice` (parseTabParam).
**C2.** ✅ [tabs/practice-tab.tsx](../../apps/web/src/components/workspaces/tabs/practice-tab.tsx) — Atom-centric list:
  - Top stats: số atom + tổng flashcard/quiz/exam + sort picker (Yếu nhất / A-Z / Khó nhất)
  - Mỗi atom row: mastery chip 3 màu (master/đang học/yếu/chưa biết) + name + preview Q + counts FC/Q/Ex + button "Ôn" + link atom detail
  - Generate buttons (Flashcard / Quiz / Exam) ở top row — share toolbar thay vì 3 tab.
**C3.** ✅ Atom detail page [`/workspaces/[id]/atoms/[atomId]`](../../apps/web/src/app/(app)/workspaces/[id]/atoms/[atomId]/page.tsx) + [AtomDetailClient](../../apps/web/src/components/atoms/atom-detail-client.tsx):
  - Header: name + domain + mastery chip + difficulty chip
  - Definition + examples bullet
  - Preview Q/A card (nếu LLM đã sinh)
  - Mastery card: 3 timestamp (Flashcard / Quiz / Exam) với relative time
  - Sections lazy-loaded: flashcards (state badge) + quiz questions (grouped by quiz) + exam questions
**C4.** ✅ API mới:
  - [`GET /api/workspaces/[id]/atoms`](../../apps/web/src/app/api/workspaces/[id]/atoms/route.ts) — list atom scoped workspace, kèm mastery + counts FC/Q/Ex, sort theo mastery/name/difficulty
  - [`GET /api/atoms/[id]/items?workspaceId=X`](../../apps/web/src/app/api/atoms/[id]/items/route.ts) — flashcards (user-scoped) + quiz questions + exam questions của atom
**C5.** ✅ Overview tab cập nhật: 6 stat card → 4 (Documents / Notes / **Practice** / Chats); quick actions thay "Generate flashcard" bằng "Practice atom".

**Verify:**
- Typecheck `@cogniva/web` pass
- Manual test cần làm:
  1. Vào `/workspaces/<id>` → thấy 5 tab (Overview, Documents, Notes, Practice, Chats) thay vì 7
  2. Click tab Practice → list atom với mastery chip màu (đỏ/vàng/xanh/xám)
  3. Click atom name → atom detail page với preview Q/A + mastery card + list flashcard/quiz/exam
  4. URL bookmark cũ `?tab=flashcards` → tự redirect logic về Practice tab

**Deferred Phase C+:**
- "Học atom này 10 phút" Pomodoro session (chỉ có button "Ôn" link tới /flashcards/review hiện tại — chưa filter scope theo atom)
- Inline expand atom row để xem flashcard trực tiếp (current: phải click vào atom detail)
- Workspace-scoped flashcard review queue (atom button "Ôn" hiện link `/flashcards/review?atom=ID` nhưng review page chưa support filter)

### Phase D — AI Tutor slide-out (~2 ngày) — ✅ SHIPPED 2026-05-20

**D1.** ✅ [components/ui/drawer.tsx](../../apps/web/src/components/ui/drawer.tsx) — Radix Dialog primitive slide-out side=right (`max-w-md` desktop, full width mobile). Không thêm dependency mới (vaul) — reuse Radix Dialog có sẵn.
**D2.** ✅ [components/ai-tutor/ai-tutor-context.tsx](../../apps/web/src/components/ai-tutor/ai-tutor-context.tsx) — Provider quản lý `open` state + `pinnedAtoms` (max 5) + Cmd/Ctrl+J global hotkey listener + `openWithAtom(atom)` convenience.
**D3.** ✅ [components/ai-tutor/ai-tutor-drawer.tsx](../../apps/web/src/components/ai-tutor/ai-tutor-drawer.tsx) — mini chat UI dùng `useChat` của `@ai-sdk/react`, ephemeral session (reset messages mỗi lần đóng/mở), forward `atomIds` vào body. Pinned atom chip strip ở header. Footer có link "Mở full chat" → `/chat/new`.
**D4.** ✅ Mount `<AiTutorProvider>` + `<AiTutorDrawer>` ở [(app)/layout.tsx](../../apps/web/src/app/(app)/layout.tsx) — chỉ render 1 lần cho toàn app, portal vào body.
**D5.** ✅ [components/ai-tutor/ai-tutor-trigger.tsx](../../apps/web/src/components/ai-tutor/ai-tutor-trigger.tsx) — button sparkles ở topbar (giữa Pomodoro và ThemeToggle), tooltip nhắc ⌘J.
**D6.** ✅ [/api/chat](../../apps/web/src/app/api/chat/route.ts) extend body `atomIds?: string[]` (max 5). Khi pass: query concept + chunk_concept pivot → INJECT "## 🎯 ATOM USER ĐANG FOCUS" section vào system prompt với name/description/examples/preview Q/A + 2 chunk gốc/atom (top strength). Best-effort: lỗi không kill request.
**D7.** ✅ Atom detail page auto-pin atom khi mount (cleanup khi unmount) + nút "Hỏi AI Tutor" header gọi `openWithAtom`.

**Verify:**
- Typecheck `@cogniva/web` pass
- Manual test cần làm:
  1. Bấm ⌘J / Ctrl+J ở bất kỳ page (app) → drawer slide từ phải
  2. Vào `/workspaces/<id>/atoms/<atomId>` → atom auto-pin vào drawer (chip xuất hiện nếu mở)
  3. Bấm "Hỏi AI Tutor" trong atom detail → drawer mở với atom đã pin
  4. Gõ câu hỏi → AI tham khảo atom context (system prompt có atom info + chunks)
  5. Đóng drawer → messages reset (ephemeral); pin atom cleared khi navigate khỏi atom detail

**Deferred Phase D+:**
- URL-based auto-pin theo pathname (vd ở `/documents/[id]#page-3` → pin chunk page 3) — V1 chỉ wire ở atom detail
- Slide-out cho flashcard review ("Tại sao sai?" nút) — V1 không có
- Slide-out cho graph node click — V1 không có (cần wire ở Phase E)
- Persist conversation nếu user muốn (V1 ephemeral; user mở "Mở full chat" để persist)
- Context auto-pin theo searchParams (`?atom=X`)

### Phase E — Graph state (~1 ngày)

**E1.** `/api/concepts/graph` extend trả mastery + counts per node
**E2.** Graph component map mastery → color (3 màu)
**E3.** Click node action sheet: "Học atom này" / "Show source" / "Hỏi AI Tutor"

### Phase F — Cleanup + telemetry (~1 ngày)

**F1.** Audit log event mới: `atom-review`, `atom-mastery-change` cho dashboard /admin/ai
**F2.** PostHog event: `atom_session_started`, `atom_session_completed` (15-min session)
**F3.** Bỏ `/flashcards` standalone page? Hoặc redirect → `/practice?type=flashcard&workspace=all`
**F4.** Update [docs/plans/master.md](master.md) — section §F (Phase 5-6) note pivot sang atom-centric

---

## 7. Effort estimate

| Phase | Mô tả | Backend | Frontend | Total |
|-------|-------|---------|----------|-------|
| A | Wiring backend (migration + applyAttempt + AtomView) | 2-3 ngày | — | 2-3 ngày |
| B | Today + Study Plan AI | 1 ngày | 2 ngày | 3 ngày |
| C | Practice tab gộp + Atom detail | 0.5 ngày | 2 ngày | 2.5 ngày |
| D | AI Tutor slide-out | 0.5 ngày | 1.5 ngày | 2 ngày |
| E | Graph state coloring | 0.5 ngày | 0.5 ngày | 1 ngày |
| F | Cleanup + telemetry | 0.5 ngày | 0.5 ngày | 1 ngày |
| | **Tổng** | **5 ngày** | **7 ngày** | **~2 tuần** |

→ 1 dev full-time ~10-12 ngày làm việc.

---

## 8. Open questions

### 8.1. Atom granularity — bao lớn?

LLM extract concept hiện tại sinh ra ~10-30 concept / document 50 trang. Có
nên gộp / chia nhỏ?

- **Quá to** (1 concept = 1 chương) → flashcard không generate được cụ thể
- **Quá nhỏ** (1 concept = 1 câu) → graph 1000 nodes, user choáng

**Hint:** Giữ default hiện tại (10-30/doc). Phase A8 thêm field
`difficulty` để có thể filter/cluster sau.

### 8.2. 1 atom = nhiều flashcard?

Hiện tại 1 flashcard = 1 row. Atom-centric đặt câu hỏi: 1 atom "Lamport
timestamp" có nên có 3 flashcard (basic Q/A + cloze + reverse) tự động
không?

**Đề xuất:** Phase A6 LLM generate 2 flashcard/atom (basic + 1 cloze nếu phù
hợp). User có thể add thêm manual sau.

### 8.3. Atom shared across workspace?

Hiện tại `concept.workspace_id` là REQUIRED. Nếu user upload "Hệ phân tán
v1" ở workspace A và "Hệ phân tán v2" ở workspace B → 2 atom "Lamport
timestamp" trùng nhau, mastery không share.

**Đề xuất Phase B+:** Thêm `concept.canonical_id` nullable — point sang atom
"chính" (sau dedup). Mastery query: `WHERE concept_id IN (id, canonical_id)`.
Defer Phase G nếu chưa cần.

### 8.4. Migration cho user cũ — backfill mastery từ flashcard history?

Nếu user X đã review 200 flashcard trước migration, sau migration
`flashcard.concept_id` được populate, nhưng mastery chưa update vì những
review đã xảy ra rồi.

**Options:**
- (a) Replay: chạy script đọc `flashcard.last_review` + `flashcard.state` →
  call `applyAttempt` retroactively
- (b) Reset: bỏ qua history, mastery start từ 0 cho atom mới link
- (c) Heuristic: nếu flashcard.state = REVIEW → mastery 0.7; LEARNING → 0.3;
  NEW → 0

**Đề xuất:** Option (c). Migration 0032 += UPDATE mastery với heuristic.

### 8.5. Workspace có nên enforce 1+ atom trước khi gen flashcard?

Hiện flow: upload doc → user bấm "AI generate flashcard" → AI generate từ
chunk text trực tiếp. Sau refactor: chuyển thành "upload doc → AI extract
atom (auto khi ingest) → user bấm 'gen flashcard' → AI gen từ atom".

→ Cần auto-extract concept khi ingest document (hiện chỉ chạy nếu admin
trigger). **Decision:** Phase A7 wire extract vào `ingestDocument()`.
Trade-off: +5-15s mỗi upload, +LLM cost. Có thể defer sang BullMQ async.

---

## 9. Non-goals

Refactor này **KHÔNG bao gồm**:

- Rename DB tables (`concept` → `atom`) — defer khi không có gì khác làm
- Rewrite knowledge graph layout algorithm — giữ Dagre hybrid hiện tại
- Cross-user atom sharing (canonical atom) — Phase G+
- Mobile app changes — chỉ web
- LLM router changes — atom extraction reuse provider router hiện tại
- Vector index reshuffle — concept.embedding đã có HNSW
- BullMQ queue — Phase A vẫn sync; chuyển async Phase B nếu thấy chậm

---

## 10. Định nghĩa "shipped"

Refactor coi như xong khi:

1. ✅ User upload PDF mới → AI tự extract atom → 0 click thêm để có flashcard +
   quiz + graph node ready
2. ✅ User review flashcard sai → 1 phút sau mở graph → node atom đó đổi vàng
3. ✅ User vào workspace → thấy "Hôm nay" card với 5 atom review (không phải
   todo trống)
4. ✅ User đang đọc PDF → bấm Cmd+J → AI Tutor mở với chunk hiện tại pre-pinned
   (không phải PDF whole)
5. ✅ Study Plan page show AI proposal, không phải todo input trống
6. ✅ Click node graph xám → action sheet "Học 10 phút" → vào Pomodoro
7. ✅ Type check + unit test pass; e2e smoke (upload → atom → flashcard → review
   → mastery) pass

---

*Plan v1.0 — viết 2026-05-20 sau khi user critique kiến trúc feature-centric.
Update khi build từng phase.*
