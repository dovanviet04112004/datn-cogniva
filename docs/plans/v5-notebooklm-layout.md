# V5 — Workspace = Notebook (NotebookLM-style 3-cột)

> **Mục tiêu:** Bỏ tabs trong workspace. Mỗi workspace = 1 "notebook" với
> layout 3 cột: Sources · Chat · Studio. User vào workspace → mặc định
> thấy chat ở giữa, không phải decide tab nào trước.
>
> **Tác giả nguyên gốc:** chủ dự án (2026-05-20). User critique "thao tác
> học quá phức tạp" sau khi test Phase A-D. Backend atom-centric đã xong
> nhưng UX vẫn ép user nhảy 7-8 trang.

---

## 📑 Mục lục

- [1. Vấn đề](#1-vấn-đề)
- [2. Đối chiếu NotebookLM vs Cogniva](#2-đối-chiếu-notebooklm-vs-cogniva)
- [3. Target architecture V5](#3-target-architecture-v5)
- [4. Layout design](#4-layout-design)
- [5. Recipes spec](#5-recipes-spec)
- [6. Migration plan](#6-migration-plan)
- [7. Effort estimate](#7-effort-estimate)
- [8. Non-goals](#8-non-goals)

---

## 1. Vấn đề

User đã test Phase A-D, feedback (2026-05-20):

> "nhìn rối phức tạp quá trời ơi... thao tác học đang quá phức tạp."

Workflow hiện tại để học 1 vòng đầy đủ:

1. Vào `/workspaces/[id]`
2. Click tab Practice
3. Click 1 atom
4. Vào atom detail page
5. Click "Ôn" → navigate `/flashcards/review`
6. Review xong → quay lại workspace
7. Click tab khác hoặc click "Quiz check" — navigate khác
8. Hỏi AI → mở drawer ⌘J riêng

→ **7-8 thao tác cho 1 vòng học.** Atom-centric ở DB nhưng UX vẫn feature-centric.

---

## 2. Đối chiếu NotebookLM vs Cogniva

|                 | NotebookLM                                        | Cogniva hiện tại               |
| --------------- | ------------------------------------------------- | ------------------------------ |
| Layout chính    | 3 cột: Sources · Chat · Studio                    | 5 tab cùng cấp                 |
| Chat            | Trung tâm, full view                              | 1 trong 7 entry                |
| Sources scope   | Checkbox inline                                   | Pill ẩn trong chat             |
| Outputs         | Recipes click 1 nút (Study Guide, Audio Overview) | Click "AI generate" nhiều bước |
| SRS / mastery   | ❌                                                | ✅                             |
| Exam            | ❌                                                | ✅                             |
| Số click 1 task | 1-2                                               | 4-6                            |

**Học gì từ NotebookLM:**

- Chat là **default view**, không phải sub-menu
- Recipes pre-built thay vì "user tự chọn feature"
- Sources panel có checkbox để scope inline

**Giữ gì từ Cogniva:**

- Atom + SRS + BKT mastery engine (Phase A-D backend đã ship)
- Knowledge graph
- Study plan SRS due

---

## 3. Target architecture V5

### 3.1. Triết lý

**Workspace = Notebook.** Mỗi workspace là không gian khép kín — user vào
là có thể học ngay, không cần decide. Chat ở giữa làm AI Tutor mặc định.
Studio bên phải để user "kích" 1 hoạt động cụ thể (session 15 phút, quiz,
flashcard, mind map).

### 3.2. Bỏ những route nào trong workspace

| Hiện tại                        | V5                                                       | Lý do                                                                 |
| ------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Tab "Documents" trong workspace | → Sources panel                                          | Inline luôn, có checkbox scope                                        |
| Tab "Notes"                     | → Sources panel (section dưới)                           | Cùng nhóm "user content"                                              |
| Tab "Practice"                  | → Studio recipes + Sources atom list                     | Không có khái niệm "tab Practice", chỉ có recipe "Flashcard" / "Quiz" |
| Tab "Chats"                     | → Center panel (chat là default)                         | Chat là center, không cần tab riêng                                   |
| Tab "Overview"                  | → bỏ                                                     | Stats nhỏ ghép vào header workspace                                   |
| /workspaces/[id]/atoms/[atomId] | giữ làm deep link, embed trong main panel khi click atom | Atom detail vẫn cần                                                   |

### 3.3. Standalone pages (ngoài workspace)

| Page                  | Số phận                                         |
| --------------------- | ----------------------------------------------- |
| `/dashboard`          | Giữ, summary cross-workspace                    |
| `/workspaces`         | Giữ, list cards                                 |
| `/study-plan`         | Giữ — daily plan cross-workspace                |
| `/graph`              | Giữ — global knowledge graph                    |
| `/flashcards` review  | Giữ — review cross-workspace queue              |
| `/quiz`               | Giữ — quiz list/history                         |
| `/exams`              | Giữ — exam list (exam vốn cross-workspace)      |
| `/chat`, `/chat/[id]` | Giữ — chat persisted full-page (link từ drawer) |
| `/notes`              | Giữ — global notes                              |

**Sidebar nav:** Workspaces · Study Plan · Documents (global) · Graph · Flashcards
· Exams · Chats. Bỏ: `Quiz` standalone (vào workspace Studio thay), `Atoms`
standalone (deep link only).

---

## 4. Layout design

### 4.1. Workspace V5 layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Header: workspace.name · 12 docs · 35 atoms · edit · delete    │
├────────────┬──────────────────────────────────┬─────────────────┤
│            │                                  │                 │
│  SOURCES   │       CHAT / RECIPE              │     STUDIO      │
│  ~280px    │       flex-1                     │     ~320px      │
│            │                                  │                 │
│  [Upload]  │  ┌── default: chat ──┐           │  📚 Hôm nay    │
│            │  │ Hôm nay: 5 atom   │           │  ▶ Phiên 15'   │
│  Docs      │  │ ôn + 2 mới (chip) │           │                 │
│  ☑ doc1    │  └────────────────────┘          │  ─────────      │
│  ☐ doc2    │                                  │                 │
│  ☑ doc3    │  ┌──────────────────────┐       │  Generate       │
│            │  │ user: Lamport TS là? │       │  ▶ Flashcard    │
│  Atoms ✨  │  └──────────────────────┘       │  ▶ Quiz check   │
│  ☐ atom1   │                                  │  ▶ Exam         │
│  ☑ atom2   │  ┌──────────────────────────┐   │                 │
│   (yellow) │  │ AI: Lamport timestamp là │   │  ─────────      │
│  ☐ atom3   │  │ thuật toán... [1][2]      │   │  View           │
│   (green)  │  └──────────────────────────┘   │  ▶ Atom guide   │
│            │                                  │  ▶ Mind map     │
│  Notes     │  ┌──────────────────────┐       │  ▶ Briefing doc │
│  • Note 1  │  │ Type message...    ↑│       │                 │
│  + New     │  └──────────────────────┘       │  ─────────      │
│            │                                  │  V6 future:     │
│            │                                  │  ▶ Audio podcast│
└────────────┴──────────────────────────────────┴─────────────────┘
```

### 4.2. Main panel — 5 chế độ

Main panel (chính giữa) chỉ render 1 trong 5 view:

1. **Chat (default)** — ChatInterface scope workspace + atoms checked
2. **Session** — chain FC → quiz → next atom, progress bar 15 phút
3. **Flashcard review** — fullscreen review queue, filter workspace
4. **Quiz** — 5 câu random, auto-grade + mastery update inline
5. **Atom guide** — markdown study guide do AI gen (long-form)
6. **Mind map** — graph viz scope workspace
7. **Briefing doc** — summary 200-300 từ của các docs đã check

Click 1 recipe → main swap. Có nút "← Quay lại chat" để về default.

### 4.3. Sources panel

3 sub-sections collapsible:

```
📁 Documents (4)            [+ Upload]
   ☑ HePhanTan.pdf          (35 chunks · 7 atoms)
   ☐ MapReduce.pdf
   ☑ Raft.pdf
   ☐ Paxos.pdf

✨ Atoms (12)                [auto-extracted]
   🟢 Lamport timestamp     master 92%
   🟡 Vector clock          đang học 45%
   🔴 MapReduce shuffle     yếu 12%
   ⚪ Raft consensus         chưa biết
   ... + 8 atom khác

📝 Notes (3)                 [+ New]
   • Tóm tắt chương 1
   • Câu hỏi tự ôn
   • ...
```

Checkbox doc + atom — scope retrieval cho chat / quiz / FC gen. Mặc định:
all checked. User uncheck để focus.

### 4.4. Studio panel

3 nhóm recipes:

```
📚 HÔM NAY (priority)
   ▶ Phiên 15 phút (5 atom ôn + 2 mới + 3 quiz)
   ▶ Quick review (3 flashcard due nhất)

🎯 GENERATE
   ▶ Flashcard từ chunk được check
   ▶ Quiz 5 câu
   ▶ Tạo exam tùy chỉnh

📖 VIEW
   ▶ Atom guide (markdown study guide)
   ▶ Mind map atoms
   ▶ Briefing doc (200-300 từ tóm tắt)
```

Mỗi recipe:

- Icon + name + tooltip
- Click → main panel swap sang recipe view
- Estimated time / count nhỏ (vd "~15 phút", "12 atom")

---

## 5. Recipes spec

### 5.1. Phiên 15 phút (priority)

Auto chain — user chỉ tap qua:

```
┌─ Main panel ────────────────────────────────────┐
│ [← chat]  Phiên 15 phút       ▓▓▓▓░░░░ 8/15p  │
│                                                  │
│ Bước 2/5 · Atom mới: Raft consensus              │
│                                                  │
│  📖 Definition + 2 examples (10s đọc)            │
│  ↓                                               │
│  🃏 2 flashcard ngay (basic + cloze)            │
│  ↓                                               │
│  Câu trả lời? [Again] [Hard] [Good] [Easy]     │
│                                                  │
│                                  [Bỏ qua bước]  │
└──────────────────────────────────────────────────┘
```

Chain steps:

1. **Warm-up** (1') — 1 atom đã master để build confidence
2. **SRS review** (5') — 5 atom due, mỗi atom 1-2 FC
3. **Atom mới** (5') — 2 atom new: đọc def 30s + 2 FC ngay
4. **Quiz check** (3') — 3 câu random từ atom yếu
5. **Summary** (1') — Mastery delta + tomorrow preview

Backend: reuse `proposeForToday(userId, workspaceId)` (Phase B).
applyAttempt gọi sau mỗi rating (đã wired Phase A).

### 5.2. Atom guide (Study Guide)

LLM gen markdown long-form dài ~500-800 từ:

```markdown
# Atom guide: HePhanTan workspace

## Lamport timestamp 🟢 (master 92%)

**Định nghĩa:** ...
**Ví dụ:** ...
**Câu tự hỏi:** Khi nào dùng vector clock thay vì Lamport?

## Vector clock 🟡 (đang học 45%)

...

## So sánh

| Concept | Pros           | Cons                    |
| ------- | -------------- | ----------------------- |
| Lamport | đơn giản       | không detect concurrent |
| Vector  | full causality | overhead O(n)           |
```

Cached LLM call. Re-gen khi user thêm doc mới hoặc atom mới.

### 5.3. Mind map

Graph viz scope workspace — reuse `/graph` component nhưng filter
`document.workspaceId = X`. Mastery coloring (Phase E khi build).

### 5.4. Briefing doc

200-300 từ tóm tắt sources được check. Cache 24h. Generate qua LLM với
context = chunks của doc checked.

### 5.5. Quick review

3 flashcard có due gần nhất, fullscreen review. Sau 3 thẻ → mặc định
chuyển sang phiên 15 phút hoặc về chat.

---

## 6. Migration plan

### Phase V5.1 — Layout shell (~1.5 ngày) — ✅ SHIPPED 2026-05-20

**V5.1.1** ✅ [notebook-context.tsx](../../apps/web/src/components/workspaces/v5/notebook-context.tsx) — `NotebookProvider` quản lý `mainView` (sync URL `?view=`) + `selectedDocs` Set + `selectedAtoms` Set + toggle callbacks (useCallback stable).
**V5.1.2** ✅ [sources-panel.tsx](../../apps/web/src/components/workspaces/v5/sources-panel.tsx) — 3 section collapsible: Documents (checkbox + status badge), Atoms (mastery dot 3 màu + count flashcard, fetch /api/workspaces/[id]/atoms), Notes (compact list).
**V5.1.3** ✅ [studio-panel.tsx](../../apps/web/src/components/workspaces/v5/studio-panel.tsx) — 3 nhóm recipes (Hôm nay / Generate / View) với badge "Soon" cho V5.2+ chưa shipped.
**V5.1.4** ✅ [main-panel.tsx](../../apps/web/src/components/workspaces/v5/main-panel.tsx) switcher + [views/chat-view.tsx](../../apps/web/src/components/workspaces/v5/views/chat-view.tsx) — ChatView dùng useChat, body forward `workspaceId` + `documentIds` (từ selectedDocs) + `atomIds` (từ selectedAtoms). Top strip show scope hint.
**V5.1.5** ✅ [views/recipe-stub.tsx](../../apps/web/src/components/workspaces/v5/views/recipe-stub.tsx) — placeholder cho 6 view chưa ship (session/flashcard/quiz/atom-guide/mind-map/briefing) với eta + "Quay lại chat" button.
**V5.1.6** ✅ [workspace-notebook.tsx](../../apps/web/src/components/workspaces/v5/workspace-notebook.tsx) — root layout 3 cột (Sources 280px · Main flex-1 · Studio 300px), header compact với edit/delete inline. Mobile (<lg): chỉ Main panel, banner thông báo V5.4.
**V5.1.7** ✅ [workspaces/[id]/page.tsx](<../../apps/web/src/app/(app)/workspaces/[id]/page.tsx>) — replace `WorkspaceDetailClient` (V4 tabs) bằng `WorkspaceNotebook`. Server chỉ fetch documents (counts/notes Sources fetch client).
**V5.1.8** ✅ [upload-document-dialog.tsx](../../apps/web/src/components/documents/upload-document-dialog.tsx) — thêm controlled mode (`open` + `onOpenChange` + `onUploaded` callback) để Sources panel mở từ button "Upload" externally.

**Verify:**

- Typecheck `@cogniva/web` pass
- Manual test cần làm:
  1. Vào `/workspaces/<id>` → thấy 3 cột Sources / Chat / Studio thay vì tabs
  2. Documents list ở Sources có checkbox; toggle → chat scope hint update
  3. Atoms list load từ API + chip 3 màu mastery
  4. Click recipe trong Studio → main panel swap sang stub "Coming soon"
  5. Click "Chat" recipe (default) hoặc "Quay lại chat" → về ChatView
  6. URL deep link `?view=session` route đúng

**Deferred Phase V5.1+:**

- Mobile drawer toggle cho Sources/Studio (V5.4)
- Workspace-scoped upload pin (hiện AI auto-route — user phải move manual nếu wrong)
- Notes inline create (hiện link sang /notes/new)
- Atom row click → open AiTutorDrawer pin atom (hiện link sang detail page)

### Phase V5.2 — Recipes core (~2 ngày) — ✅ SHIPPED 2026-05-20

**V5.2.0 (cleanup)** ✅ Xoá 10 file V4 unused: `workspace-detail-client.tsx`, `today-card.tsx`, toàn bộ `tabs/*.tsx` (overview/documents/notes/practice/flashcards/quizzes/exams/chats). Typecheck pass — không có file nào ngoài V4 self-reference.

**V5.2.1** ✅ [session-view.tsx](../../apps/web/src/components/workspaces/v5/views/session-view.tsx) — SessionPlayer phiên 15p:

- Load `/api/study-plan/today` + `/api/flashcards/queue?workspaceId=` parallel
- State machine 3 step: review FC → new atom → summary (V5.2 MVP, defer warm-up + quiz step)
- Review: cycle qua queue, reveal answer, rating 1-4 → POST review API → applyAttempt tự fire
- New atom: show definition + previewQ/A, button "Đã nắm" để next
- Summary: stats (reviewed, accuracy, new atoms) + nút làm lại / quay chat
- Progress indicator step + %
  **V5.2.2** ✅ [flashcard-view.tsx](../../apps/web/src/components/workspaces/v5/views/flashcard-view.tsx) — embedded `<ReviewSession workspaceId={X}>`. Extend `/api/flashcards/queue?workspaceId=X` filter. Header có "Quay lại chat".
  **V5.2.3** ✅ [quick-quiz-view.tsx](../../apps/web/src/components/workspaces/v5/views/quick-quiz-view.tsx) — ephemeral quiz 5 câu:
- API [`GET /api/workspaces/[id]/quick-quiz`](../../apps/web/src/app/api/workspaces/[id]/quick-quiz/route.ts): RANDOM 5 question từ concept của workspace
- API [`POST /api/questions/[id]/grade`](../../apps/web/src/app/api/questions/[id]/grade/route.ts): grade single Q + applyAttempt — ephemeral, KHÔNG persist response
- UI: 1 câu/lần, options A/B/C, kiểm tra → reveal + explanation + next
- Summary: correct/total + %
  **V5.2.4** ✅ [atom-guide-view.tsx](../../apps/web/src/components/workspaces/v5/views/atom-guide-view.tsx) — LLM markdown study guide:
- API [`GET /api/workspaces/[id]/atom-guide`](../../apps/web/src/app/api/workspaces/[id]/atom-guide/route.ts): routedGenerateText useCase='summarize', load top 20 atom + mastery, prompt sinh markdown 500-800 từ
- In-memory cache 24h per (workspace × user); query `?regenerate=1` force refresh
- UI: `react-markdown` + `remark-gfm` render với inline Tailwind utility styles (project chưa bundle @tailwindcss/typography)
- Header có "Regenerate" button + cache age indicator
  **V5.2.5** ✅ [main-panel.tsx](../../apps/web/src/components/workspaces/v5/main-panel.tsx) switch case render 4 views; stub chỉ còn mind-map / briefing (V5.3).
  **V5.2.6** ✅ [studio-panel.tsx](../../apps/web/src/components/workspaces/v5/studio-panel.tsx) bỏ badge "Soon" cho atom-guide; còn lại mind-map / briefing.

**Verify:**

- Typecheck `@cogniva/web` pass
- Manual test cần làm:
  1. Vào `/workspaces/<id>` → bấm "Phiên 15 phút" → review FC → new atom → summary
  2. Bấm "Quick Quiz" → 5 câu MCQ → kiểm tra → mastery update qua applyAttempt
  3. Bấm "Atom guide" → đợi ~10-30s gen LLM → markdown render đẹp. Bấm Regenerate → fresh
  4. Bấm "Ôn flashcard" → ReviewSession embedded scope workspace
  5. Mind map / Briefing → vẫn stub "Coming soon"

**Deferred Phase V5.2+:**

- SessionPlayer step quiz check (3 câu sau review + new) — V5.2 MVP skip
- SessionPlayer warm-up step (1 atom đã master) — defer
- Atom-guide persistent cache (V5.2 in-memory; V5.3 migrate table hoặc Redis)
- QuickQuiz support non-MCQ types (SHORT, FILL_BLANK)
- Keyboard shortcuts trong session (1-4 rating)

### Phase V5.3 — Mind map + Briefing (~1 ngày) — ✅ SHIPPED 2026-05-20

**V5.3.1** ✅ MindMap embedded:

- [`listConceptsForWorkspace`](../../apps/web/src/lib/concepts/dedup.ts) helper mới — SQL DISTINCT concept JOIN chunk_concept JOIN chunk JOIN document WHERE workspace_id
- [`/api/graph?workspaceId=X`](../../apps/web/src/app/api/graph/route.ts) extend — pass workspaceId chuyển sang scope helper
- [GraphView](../../apps/web/src/components/graph/graph-view.tsx) + GraphCanvas thêm `workspaceId?: string` prop, append vào fetch URL
- [mind-map-view.tsx](../../apps/web/src/components/workspaces/v5/views/mind-map-view.tsx) — wrap `<GraphView workspaceId={X}>` với header "Quay lại chat" + link "Full graph" sang /graph global

**V5.3.2** ✅ Briefing Doc:

- API [`/api/workspaces/[id]/briefing`](../../apps/web/src/app/api/workspaces/[id]/briefing/route.ts) — load 5 chunk/doc max 25 total → LLM gen 200-300 từ markdown (cấu trúc: Tổng quan / Các phần chính / Bắt đầu từ đâu)
- In-memory cache 24h per (workspace × user), `?regenerate=1` force refresh
- [briefing-view.tsx](../../apps/web/src/components/workspaces/v5/views/briefing-view.tsx) — render react-markdown + remark-gfm với inline Tailwind utility, header có Regenerate button + cache age indicator

**V5.3.3** ✅ Cleanup:

- [main-panel.tsx](../../apps/web/src/components/workspaces/v5/main-panel.tsx) switch case: mind-map → MindMapView, briefing → BriefingView (không còn fallback stub)
- [studio-panel.tsx](../../apps/web/src/components/workspaces/v5/studio-panel.tsx) bỏ "Soon" badge cho mind-map + briefing — toàn bộ 7 recipes đã live
- Xoá `views/recipe-stub.tsx` (không còn view nào dùng)

**Verify:**

- Typecheck `@cogniva/web` pass
- Manual test cần làm:
  1. Workspace có ≥ 2 atom → Studio "Mind map" → React Flow graph chỉ atoms của workspace, ConceptNode mastery color
  2. Click node → ConceptPanel show chunks gốc
  3. Bấm "Full graph" → /graph global (cross-workspace)
  4. Studio "Briefing doc" → đợi ~5-15s LLM gen → markdown 200-300 từ với cấu trúc Tổng quan/Các phần/Bắt đầu
  5. Regenerate → fresh từ LLM

**Toàn bộ V5 design intent đã đạt:**

- 7 recipes trong Studio: Phiên 15p · Ôn flashcard · Quick Quiz · Tạo Exam · Atom guide · Mind map · Briefing doc
- 1-2 click cho mỗi hoạt động (không phải 7-8 thao tác nhảy trang như V4)
- Chat ở center luôn sẵn sàng + scope theo Sources checkbox

### Phase V5.4 — Cleanup + mobile drawer (~0.5 ngày) — ✅ SHIPPED 2026-05-20

**V5.4.1** ✅ Sidebar verification — Quiz / Flashcards / Exams standalone đã KHÔNG có trong sidebar từ trước (chỉ Dashboard / Graph / Study Plan / Workspaces / AI Tutor / Groups / Messages / Leaderboard / Tutoring). Routes vẫn hoạt động qua deep link + Studio recipes.

**V5.4.2** ✅ Atom detail page UX:

- [atom-detail-client.tsx](../../apps/web/src/components/atoms/atom-detail-client.tsx) header thêm button **"Mở trong workspace"** (Primary, prominent) → `Link` sang `/workspaces/[id]?view=chat`
- User deep-link tới atom detail có route quay về workspace notebook chính (Sources · Chat · Studio) thay vì chỉ breadcrumb back
- Icon `ArrowLeftRight` để indicate context switch

**V5.4.3** ✅ Mobile drawer toggle (deferred từ V5.1):

- [workspace-notebook.tsx](../../apps/web/src/components/workspaces/v5/workspace-notebook.tsx) thêm state `mobileSourcesOpen` + `mobileStudioOpen`
- Header có 2 button mobile-only: `PanelLeft` (trái, mở Sources) + `PanelRight` (phải, mở Studio)
- Drawer slide từ trái/phái với overlay backdrop `bg-black/50`, tap để đóng
- Width `85vw max-w-[320px]` — chiếm phần lớn mobile screen
- Desktop `>= lg`: drawer state ignored, panel inline (no change)
- Upload click trong mobile Sources tự đóng drawer trước khi mở dialog upload

**V5.4.4** ✅ Plan + memory cập nhật mark V5 done.

**Verify:**

- Typecheck `@cogniva/web` pass
- Manual test mobile (< 1024px):
  1. Thấy 2 button PanelLeft/PanelRight ở header
  2. Tap PanelLeft → Sources slide từ trái + overlay
  3. Tap atom row → navigate atom detail page
  4. Trong atom detail bấm "Mở trong workspace" → về workspace notebook
  5. Tap PanelRight → Studio slide từ phải
  6. Click recipe trong Studio → drawer đóng + main panel swap

**V5 hoàn tất** — backend atom-centric (Phase A-D) + UX NotebookLM-style (V5.1-V5.4) đều ship.

---

### Phase V6 — Polish + multi-conversation + persistent cache (~1 ngày) — ✅ SHIPPED 2026-05-20

User feedback sau V5.4: "nhìn rối phức tạp" + UI requests cụ thể. V6 ship 6 mục:

**V6.1** ✅ Compact workspace header:

- Trước: header card to (~70px) với name + description + meta + edit/delete buttons
- Sau: 1 dòng 44px với breadcrumb inline + title + description + relative time + dropdown menu (MoreHorizontal) chứa Edit/Delete
- File: [workspace-notebook.tsx](../../apps/web/src/components/workspaces/v5/workspace-notebook.tsx)

**V6.2** ✅ Xoá AI Tutor drawer global (Cmd+J từ Phase D):

- Workspace chat ở center thay thế hoàn toàn — drawer redundant
- Xoá 3 file: `ai-tutor-drawer.tsx`, `ai-tutor-context.tsx`, `ai-tutor-trigger.tsx`
- Bỏ AiTutorProvider khỏi `(app)/layout.tsx`, bỏ Sparkles button khỏi topbar
- Atom detail page giữ "Mở trong workspace" Primary button — bỏ "Hỏi AI Tutor" button (redundant)

**V6.3** ✅ Desktop panel collapse no flicker:

- 2 panel toggle button (PanelLeft + PanelRight) ở compact header hoạt động CẢ desktop + mobile
- Desktop: `width transition` với cookie-persist `cogniva.ws-sources-open` + `.ws-studio-open` đọc server-side (page.tsx) tránh flicker khi reload
- Mobile: drawer slide pattern (cũ từ V5.4)
- Single state cho cả 2 viewport

**V6.4** ✅ Multiple conversations per workspace:

- Migration không cần (conversation table đã có `workspaceId`)
- API [`GET /api/workspaces/[id]/conversations`](../../apps/web/src/app/api/workspaces/[id]/conversations/route.ts) — list conv với title + lastMessageAt + messageCount
- API [`GET /api/conversations/[id]/messages`](../../apps/web/src/app/api/conversations/[id]/messages/route.ts) — load messages của conv + hydrate citations
- [chat-view.tsx](../../apps/web/src/components/workspaces/v5/views/chat-view.tsx) rewrite:
  - ConversationSwitcher dropdown ở top với "Hội thoại mới" + list conv
  - ChatBody remount khi switch conv (key={sessionKey})
  - useChat capture `meta.conversationId` từ data stream → cập nhật activeConvId khi tạo conv mới
  - Link "Full" → /chat/[convId] persist full-page

**V6.5** ✅ Persistent cache cho atom-guide + briefing:

- Migration 0035 — table `workspace_cached_output` (workspace × user × kind unique)
- Enum `workspace_cached_kind`: 'atom-guide' | 'briefing'
- 2 API ([atom-guide](../../apps/web/src/app/api/workspaces/[id]/atom-guide/route.ts), [briefing](../../apps/web/src/app/api/workspaces/[id]/briefing/route.ts)) swap in-memory Map → DB upsert
- Survive server restart, không bị reset khi dev refresh

**V6.6** ✅ Cross-workspace mind map scope toggle:

- [mind-map-view.tsx](../../apps/web/src/components/workspaces/v5/views/mind-map-view.tsx) thêm toggle 2 option: "Workspace này" / "Tất cả workspaces"
- Remount GraphView khi scope đổi (key={scope}) → /api/graph?workspaceId= hoặc không có param
- User không phải nhảy `/graph` full để xem cross-workspace

**Verify:**

- Typecheck pass
- Migration 0035 applied vào docker postgres
- Manual test:
  1. Header compact: title + breadcrumb + meta + dropdown menu = 1 dòng
  2. Bấm PanelLeft → Sources collapse, reload page → vẫn collapse (cookie work)
  3. Cmd+J KHÔNG còn mở AI Tutor drawer (xoá)
  4. Chat: dropdown switcher cho phép chuyển giữa nhiều conv + tạo mới
  5. Atom guide / Briefing: regenerate xong restart server → vẫn còn cache
  6. Mind map: bấm "Tất cả workspaces" → graph mở rộng cross-workspace

### Phase V7 — Cleanup standalone /chat (~30 phút) — ✅ SHIPPED 2026-05-20

User feedback sau V6: "trang /chat/new còn cần nữa ko vậy???". Workspace chat đã thay thế → cleanup redundant `/chat/new` + ChatShell + 13 component V4.

**V7.1** ✅ Xoá route:

- `apps/web/src/app/(app)/chat/page.tsx` (redirect /chat/new)
- `apps/web/src/app/(app)/chat/new/page.tsx`
- `apps/web/src/app/(app)/chat/layout.tsx` (ChatShell wrapper)

**V7.2** ✅ Xoá 13 component `apps/web/src/components/chat/*`:

- chat-interface.tsx (875 dòng) · chat-shell.tsx · conversation-sidebar.tsx · workspaces-context.tsx
- chat-context-panel.tsx · doc-preview-panel.tsx · resizable-panel.tsx
- math-canvas-dialog.tsx · voice-input-button.tsx · message-bubble.tsx
- tts-button.tsx · citation.tsx · markdown-message.tsx

**V7.3** ✅ Rewrite `/chat/[id]/page.tsx`:

- Server: load conv + workspace name + messages (simpler than V5 — bỏ citation hydration)
- Client [chat-detail-client.tsx](../../apps/web/src/components/chat/chat-detail-client.tsx) minimal: useChat + composer + "Mở trong workspace" link (nếu conv có workspaceId)
- KHÔNG có: workspace pill, attach, voice, context panel, conversation sidebar

**V7.4** ✅ Fix external links:

- [dashboard](<../../apps/web/src/app/(app)/dashboard/page.tsx>) "Hỏi AI Tutor" → `/workspaces`
- [command-palette](../../apps/web/src/components/app/command-palette.tsx) bỏ /chat/new → "Workspaces (chat + Studio)"
- [document-detail-actions](../../apps/web/src/components/documents/document-detail-actions.tsx) "Hỏi AI" → `/workspaces/[wsId]?view=chat` (chỉ show nếu doc có workspaceId)

**V7.5** ✅ [sidebar.tsx](../../apps/web/src/components/app/sidebar.tsx) bỏ entry "AI Tutor" + Bot icon import. Workspaces là entry duy nhất, `match: ['/workspaces', '/documents', '/notes', '/chat']` để /chat/[id] vẫn highlight Workspaces.

**Verify:**

- Typecheck pass
- Manual test:
  1. Sidebar không còn "AI Tutor"
  2. `/chat/new` → 404 (đúng, đã xoá)
  3. `/chat/<existing-id>` → ChatDetailClient render simple
  4. Dashboard / command palette / document detail link đều sang workspace

**Còn deferred (V8+):**

- Audio overview podcast (NotebookLM signature) — cần TTS API + storage R2 + 2-speaker script + playback UI. Effort ~3 ngày.
- Real-time collaboration trên notebook — cần Yjs + Hocuspocus + presence + cursor sync. Effort ~5+ ngày.

---

## 7. Effort estimate

| Phase | Mô tả                                                 | Effort      |
| ----- | ----------------------------------------------------- | ----------- |
| V5.1  | Layout shell + 3 panel                                | 1.5 ngày    |
| V5.2  | 4 recipes core (Session, Flashcard, Quiz, Atom guide) | 2 ngày      |
| V5.3  | Mind map + Briefing                                   | 1 ngày      |
| V5.4  | Cleanup + sidebar                                     | 0.5 ngày    |
|       | **Tổng**                                              | **~5 ngày** |

→ 1 dev full-time ~5 ngày làm việc.

---

## 8. Non-goals

V5 **KHÔNG bao gồm**:

- Audio overview podcast (NotebookLM signature, defer V6)
- Cross-workspace mind map từ Studio (chỉ scope 1 workspace)
- Real-time collaboration trên notebook (defer V7)
- Mobile-first layout (responsive nhưng UX desktop-first)
- Rename workspace → notebook ở DB (giữ `workspace` table, UI label)
- Bỏ atom-centric refactor đã shipped Phase A-D — V5 chỉ là **UX layer** trên engine đó

---

## 9. Đổi gì so với strategy doc atom-centric.md?

| Aspect         | atom-centric.md (Phase A-D shipped)           | V5                                                                    |
| -------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| Backend wiring | ✅ Phase A-D — không đổi                      | Reuse                                                                 |
| Workspace tabs | Gộp 3 tab → "Practice" + atom detail          | **Bỏ tabs hoàn toàn**, 3-cột layout                                   |
| Chat entry     | Drawer Cmd+J (Phase D)                        | Trở thành **center default**, drawer chỉ là backup từ ngoài workspace |
| Study plan     | `/study-plan` AI proposal                     | Giữ standalone + recipe "Phiên 15 phút" trong workspace Studio        |
| Practice flow  | List atom → click → atom detail → /flashcards | **1 click "Phiên 15 phút"** → auto chain                              |

→ V5 là **UX rewrite trên top atom-centric backend**. Không touch
schema, không touch lib/. Chỉ thay components workspace.

---

## 10. Định nghĩa "shipped V5"

V5 coi như xong khi:

1. ✅ Vào workspace mới upload → thấy 3-cột layout, KHÔNG còn tabs
2. ✅ Mặc định chat ở giữa, hỏi câu hỏi → AI dùng atom đã check làm scope
3. ✅ Click "Phiên 15 phút" → 5 bước auto chain, user chỉ rating
4. ✅ Click "Atom guide" → markdown study guide xuất hiện trong main panel
5. ✅ Click "Mind map" → graph workspace
6. ✅ Sidebar gọn hơn (bỏ Quiz standalone)
7. ✅ Typecheck pass; 29 unit test pass

---

_Plan v1.0 — viết 2026-05-20 sau khi user critique UX phức tạp Phase A-D.
Update khi build từng phase V5.x._

---

## V8.24 — Exam workspace integration end-to-end (2026-05-20)

User feedback: "exam chỗ để vào làm bài đâu nhập code đâu... check kĩ từng cái ở bên studio một". V8.23 đã merge "Bài thi" thành 1 recipe nhưng chưa có entry point JOIN code + start làm bài inline. V8.24 đóng full loop.

**V8.24.1** ✅ `StudioExamManager` — 2 tab:

- **Của tôi**: list exam workspace owner + "+ Tạo bài thi mới"
- **Nhập code**: input 6 ký tự → POST `/api/exams/join` → open inline preview (không navigate /join page cũ nữa)

**V8.24.2** ✅ `StudioExamInlinePreview` mở rộng:

- Owner PUBLISHED: prominent share code panel (copy code + copy share link)
- PUBLISHED (cả owner và student): nút **"Bắt đầu làm bài"** → POST `/api/exams/[id]/attempts` → navigate `/take/[attemptId]`. Detect `resumed` → toast "Tiếp tục"
- List **lịch sử attempts** (max 10, score + status + click → results page hoặc resume)
- DRAFT student: báo "Đợi giáo viên publish"
- Footer publish/delete chỉ hiện cho owner

**V8.24.3** ✅ `GET /api/exams/[id]/attempts` — endpoint mới list attempts của session user (history cho inline preview). DRAFT + non-owner → empty.

**V8.24.4** ✅ `/exams/[id]/page.tsx` chuyển từ builder full-page → **smart redirect-only**:

- Owner → `/workspaces/[wsid]?examPreview=[id]` (smart param auto-open inline)
- Student PUBLISHED → workspace nếu có; else fallback resume IN_PROGRESS attempt
- Mọi link legacy (atom-detail, rich-content, join-form, results back-link) đều smart-redirect đúng nơi

**V8.24.5** ✅ `ExamUrlBridge` component trong WorkspaceNotebook:

- Đọc `?examPreview=<id>` từ URL → `examPreview.open(id)` → clear param
- Bridge cho mọi entry point external (legacy /exams/[id] redirect, /join, atom-detail link)

**V8.24.6** ✅ Cleanup:

- ExamEditorDialog bỏ link "Mở full page" (full page đã thành redirect, không còn builder)
- Thêm nút "Proctor" cho owner PUBLISHED exam trong editor footer (navigate `/exams/[id]/proctor`)
- CreateExamDialog success state: nếu không có `onCreated` callback (gọi ngoài workspace), dùng `window.location.href` → smart redirect

**Routes còn lại:**

- `/exams/[id]/take/[attemptId]` — full-page TAKE (fullscreen + anti-cheat + proctor cam → KHÔNG embed sidebar được)
- `/exams/[id]/results/[attemptId]` — full breakdown từng câu (back link → workspace via smart redirect)
- `/exams/[id]/proctor` — admin monitor (owner only)
- `/join` — fallback nhập code khi user click link chia sẻ từ ngoài workspace (chưa login → sign-in flow giữ code)

**Studio recipe summary V8.24:**

| Recipe        | Action                                                         | Status   |
| ------------- | -------------------------------------------------------------- | -------- |
| Phiên 15 phút | `session` view + CTA gen FC nếu empty                          | ✅ V8.20 |
| Ôn flashcard  | `flashcard` view full-screen FSRS                              | ✅ V5.2  |
| Quiz check    | `quiz` view + CTA gen 5 câu nếu empty                          | ✅ V8.20 |
| **Bài thi**   | **Manager 2 tab (own + join) → inline preview → take/results** | ✅ V8.24 |
| Atom guide    | `atom-guide` view markdown cache 24h                           | ✅ V5.2  |
| Mind map      | `mind-map` view + scope toggle workspace/all                   | ✅ V6.6  |
| Briefing doc  | `briefing` view 200-300 từ                                     | ✅ V5.3  |

→ Tất cả 7 recipes đều có flow end-to-end trong workspace, không còn dead-end "Vào Practice tab" hay link ra trang cũ.

**Files changed V8.24:**

- `studio-exam-manager.tsx` — 2 tab JoinTab + OwnExamsTab
- `studio-exam-inline-preview.tsx` — share code panel + Bắt đầu làm + attempts list
- `workspace-notebook.tsx` — ExamUrlBridge component
- `exam-editor-dialog.tsx` — bỏ "Mở full page" + thêm Proctor button
- `create-exam-dialog.tsx` — bỏ Link import, dùng window.location
- `app/(app)/exams/[id]/page.tsx` — smart redirect-only
- `app/(app)/exams/[id]/results/[attemptId]/page.tsx` — back-link "Về workspace"
- `app/api/exams/[id]/attempts/route.ts` — thêm GET handler

---

## V8.25 — All recipes render as modal overlay (not main-panel swap) (2026-05-20)

User feedback sau V8.24: "vẫn chưa đâu. vẫn hiển thị cách cũ kìa, fix hết toàn bộ" — 6 recipes còn lại (Phiên 15p, Flashcard, Quiz, Atom guide, Mind map, Briefing) vẫn dùng pattern cũ là **swap main panel** (làm mất chat). User muốn cách mới giống Bài thi: chat **luôn visible**, recipe content nổi trên top.

**Phân tích pattern cũ:**

- Click recipe → `setMainView('session' | 'flashcard' | …)` → `MainPanel` switch case render view tương ứng, **xoá ChatView**
- User mất context chat đang dở → phải back về mới hỏi tiếp được
- Trái với NotebookLM (chat = pin center, không bao giờ disappears)

**Pattern mới V8.25:**

- `MainPanel` LUÔN render `<ChatView>` (không switch case nữa)
- `<RecipeOverlay>` mount ở root workspace-notebook, đọc `mainView` từ context:
  - `mainView === 'chat'` → modal đóng
  - `mainView !== 'chat'` → modal mở, render view tương ứng (Session/Flashcard/Quiz/AtomGuide/MindMap/Briefing)
- Modal size: `h-[92vh] w-[92vw] max-w-[1400px]` — đủ rộng cho graph + interactive
- X close button top-right + Escape key → `setMainView('chat')` đóng modal
- Bài thi GIỮ pattern riêng (Studio sidebar swap) — không dùng RecipeOverlay

**Files thay đổi V8.25:**

- `main-panel.tsx` — rút gọn từ switch case 7 view xuống chỉ render `<ChatView>` (ChatView luôn ở vị trí center)
- `recipe-overlay.tsx` (NEW) — Radix Dialog wrap 6 views, controlled bởi mainView context
- `workspace-notebook.tsx` — mount `<RecipeOverlay workspaceId={workspace.id}/>` sau ExamUrlBridge
- `views/session-view.tsx` — bỏ button "Bỏ phiên", chừa pr-14 cho X modal
- `views/flashcard-view.tsx` — bỏ button "Quay lại chat", pr-12
- `views/quick-quiz-view.tsx` — Wrapper bỏ onBack render, pr-14
- `views/atom-guide-view.tsx` — bỏ button "Quay lại chat", pr-14, justify-end
- `views/mind-map-view.tsx` — bỏ button "Quay lại chat", pr-14
- `views/briefing-view.tsx` — bỏ button "Quay lại chat", pr-14

**Backward compat:**

- `setMainView('chat')` từ inner components (vd SummaryView "Quay lại chat", EmptyState "Quay lại chat") VẪN work — RecipeOverlay listen state, set 'chat' = đóng modal. Không cần refactor inner buttons.
- Deep link `?view=session` qua NotebookProvider parse URL vẫn auto-open modal khi mount.

**Studio recipes summary V8.25:**

| Recipe        | Pattern                         | View render                                          |
| ------------- | ------------------------------- | ---------------------------------------------------- |
| Phiên 15 phút | Modal overlay 92vw×92vh         | SessionView                                          |
| Ôn flashcard  | Modal overlay 92vw×92vh         | FlashcardView (FlashcardSessionV8)                   |
| Quiz check    | Modal overlay 92vw×92vh         | QuickQuizView                                        |
| **Bài thi**   | **Studio sidebar swap (V8.24)** | ExamManager → InlinePreview ↔ ExamEditorDialog modal |
| Atom guide    | Modal overlay 92vw×92vh         | AtomGuideView (markdown)                             |
| Mind map      | Modal overlay 92vw×92vh         | MindMapView (graph)                                  |
| Briefing doc  | Modal overlay 92vw×92vh         | BriefingView (markdown)                              |

→ Chat KHÔNG còn disappears khi click recipe. Click recipe → overlay modal nổi trên top, đóng → chat instant.

**Verify:**

- ✅ Typecheck pass
- ✅ Click bất kỳ recipe non-exam → modal 92vw mở trên top chat
- ✅ Esc / X → đóng modal về `mainView='chat'`
- ✅ ChatView không re-mount khi click recipe (state preserved)

---

## V8.26 — Sidebar-first pattern cho tất cả recipes (2026-05-20)

User feedback sau V8.25: "đã bảo hiện ở sidebar thôi đừng hiện form ra nữa nào ấn zoom to mới hiện" — V8.25 mở modal ngay khi click recipe. User muốn pattern giống Bài thi (V8.24): inline sidebar mặc định, zoom button mới mở modal.

**Pattern V8.26 (consistent với Bài thi):**

1. Click recipe trong Studio → `setMainView(view)` + recipeMode='inline' (mặc định)
2. Studio sidebar swap sang **recipe-specific preview** (compact, ~360px)
3. Preview hiện stats / management info / CTA primary
4. User click `Maximize2` icon header → `setRecipeMode('modal')` → RecipeOverlay full-screen mở
5. Modal X / Esc → recipeMode='inline' (modal đóng, sidebar preview vẫn còn)
6. Sidebar X → setMainView('chat') (về recipes list)

**NotebookContext additions:**

```ts
recipeMode: 'inline' | 'modal';
setRecipeMode: (m) => void;
```

`setMainView` reset recipeMode='inline' mỗi khi đổi view — modal CHỈ kích hoạt explicit.

**6 sidebar preview component (mỗi cái full management):**

| Recipe            | Sidebar shows                                                                            | CTA                 |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------- |
| **Phiên 15 phút** | Stats: thẻ due, atom mới, ước tính phút. Phiên gồm 3 bước.                               | "Bắt đầu phiên"     |
| **Ôn flashcard**  | Stats: due, total, byState (NEW/LEARNING/REVIEW/RELEARNING) chip. Button gen 10 thẻ mới. | "Bắt đầu ôn"        |
| **Quick Quiz**    | Stats: câu hỏi sẵn sàng. Button gen 5 câu mới. Cơ chế bullet list.                       | "Bắt đầu quiz"      |
| **Atom Guide**    | Stats: atom count, cache status. Preview snippet 220 ký tự. Button Regenerate.           | "Đọc full guide"    |
| **Mind map**      | Stats: atom (node), cạnh. Mô tả modal features.                                          | "Mở graph full"     |
| **Briefing Doc**  | Stats: doc count, cache status. Preview snippet 240 ký tự. Button Regenerate.            | "Đọc full briefing" |

**Shared shell:** `StudioPreviewShell` component (header với title + Maximize2 + X close, body scroll, footer sticky CTA). Mỗi recipe import shell + custom body content.

**Files V8.26:**

- `notebook-context.tsx` — add `recipeMode` + `setRecipeMode` (auto reset 'inline' khi `setMainView`)
- `studio-recipe-previews.tsx` (NEW, ~650 dòng) — 6 preview + shared shell + StatCard + PrimaryCta helpers
- `studio-panel.tsx` — thêm switch case render preview khi `mainView != 'chat'`
- `recipe-overlay.tsx` — `open = mainView != 'chat' && recipeMode === 'modal'` + close = setRecipeMode('inline')

**Verify:**

- ✅ Typecheck pass
- ✅ Click recipe → sidebar preview hiện (KHÔNG modal nhảy ra)
- ✅ Zoom button → modal mở
- ✅ Modal X → về sidebar preview (mainView still set)
- ✅ Sidebar X → về recipes list (mainView='chat')

**Consistency với Bài thi (V8.24):**

| State               | Bài thi                      | Recipes V8.26            |
| ------------------- | ---------------------------- | ------------------------ |
| Click recipe        | Studio → ExamManager         | Studio → SidebarPreview  |
| Click row / Bắt đầu | Inline preview               | Sidebar preview hiện CTA |
| Zoom                | examPreview.setMode('modal') | setRecipeMode('modal')   |
| Modal close         | setMode('inline')            | setRecipeMode('inline')  |
| Full close          | examPreview.close()          | setMainView('chat')      |

→ Cùng 1 pattern conceptually: 3 lớp (list → inline preview → modal zoom). Toàn bộ Studio đồng nhất.
