# UI Polish & Integration — Pre-Tutoring

> Trước khi build phase 21 (tutoring marketplace), consolidate UI hiện có. 3 batch, ~3-4 ngày.

## Audit findings (2026-05-13)

**14 page chính** trong `(app)/` với **4 container pattern khác nhau**:

- `/dashboard`: `max-w-6xl` (outlier)
- `/documents, /rooms`: `max-w-5xl space-y-8 py-8`
- `/chat, /flashcards, /notes, /quiz, /exams, /analytics`: `max-w-5xl space-y-6 p-6` (standard)
- `/workspaces, /profile, /groups, /settings`: `max-w-4xl p-6` (hẹp)

**5 empty/loading pattern** song song chưa unify. **Error boundary** đã có (`AppErrorBoundary`).

**Accent color conflict:**

- `emerald` dùng cho **VOICE mic on** + **success state** + **public profile** → 3 ngữ cảnh khác nhau
- Mic on nên đổi sang `indigo` (đã dùng cho voice control)
- Success state giữ `emerald`

**Sidebar:** 14 mục, 5 group. **"Spaces"** chỉ có 1 mục (Study Rooms) — cân nhắc merge. **"Tin nhắn"** lẫn tiếng Anh + Việt với mục khác.

---

## Batch A — Design tokens + page shell (DONE — 2026-05-14)

Mục tiêu: mọi page dùng chung 1 layout primitive, dễ thêm page mới không tốn thời gian.

**Deliverables:**

1. `components/layout/page-shell.tsx` — `<PageShell>` wrapper:

   ```tsx
   <PageShell title="Documents" description="..." action={<Button>...</Button>}>
     {children}
   </PageShell>
   ```

   - Container: `mx-auto max-w-5xl space-y-6 p-6`
   - Header: title + description + optional action button bên phải
   - Replace usage trong 10+ page

2. `components/layout/empty-state.tsx` — `<EmptyState>`:

   ```tsx
   <EmptyState icon={FileText} title="Chưa có document" description="..." action={...} />
   ```

   - Variant: `dashed` (default) | `card`
   - Replace 5 empty patterns

3. `components/layout/page-loading.tsx` — `<PageLoading>`:
   - Spinner + label, hoặc skeleton list (props)
   - Replace 3 loading patterns

4. Migrate pages dùng layout primitives:
   - `/dashboard`, `/workspaces`, `/profile`, `/groups`, `/settings` → max-w-5xl
   - `/documents`, `/rooms` → space-y-6 p-6 (bỏ py-8)
   - Toàn bộ page → bỏ `tracking-tight` nếu có

5. Tailwind theme tokens trong `tailwind.config.ts`:
   - Semantic color aliases: `voice-active` (indigo), `voice-mute` (red), `stage-host` (rose), `forum` (emerald), `recording-live` (red), `success` (emerald)
   - Code dùng `bg-voice-active` thay vì `bg-emerald-500` → grep được, dễ swap palette

## Batch B — Sidebar + navigation + Form-to-Dialog (DONE — 2026-05-14)

1. **Reorganize sidebar groups** — sidebar.tsx:
   - `OVERVIEW` giữ nguyên (Dashboard, Graph, Analytics)
   - **Merge** SPACES → SOCIAL (Study Rooms + Study Groups + Tin nhắn + Profile + Leaderboard)
   - `LEARN` (Workspaces, Documents, Notes, AI Tutor)
   - `PRACTICE` (Flashcards, Quiz, Exams, Study Plan)
   - Rename "Tin nhắn" → "Messages" hoặc đổi ngược "AI Tutor" → "Trợ giảng AI" (consistent VN/EN)

2. **Collapsible sections** — click section header → fold (state lưu localStorage). Sidebar 14 mục dài → user fold bớt.

3. **Mobile drawer** — refactor để dùng chung pattern shadcn Sheet thay vì custom code mỗi page.

4. **Breadcrumb global** — `<Breadcrumbs />` component cho các page nested (workspaces/[id], groups/[id], documents/[id]).

## Batch C — Empty/Loading/Error + cross-feature link (DONE — 2026-05-14)

1. Quét toàn bộ page replace ad-hoc empty/loading → `<EmptyState>` + `<PageLoading>` (đã có từ batch A).

2. **Cross-feature integration shortcuts:**
   - Document detail → button "Hỏi AI Tutor về tài liệu này" → `/chat?workspaceId=X&doc=Y`
   - Document detail → button "Tạo flashcard từ chunks"
   - Note → "Generate quiz"
   - Workspace → "Tạo study group cùng workspace này"
   - Study group → import shared documents từ user workspace

3. **Status badge unified** — `<StatusBadge variant="success|warning|destructive|info|secondary">` thay vì 5 component custom.

4. **Color semantic fixes:**
   - voice-stage.tsx:198 mic on: `emerald` → `indigo`
   - profile.tsx:106 public badge: `emerald` → `success` token
   - group-settings.tsx:249 verify OWNER role badge dùng đúng `amber`

## Out of scope (lưu phase sau)

- Dark/light theme refinement (đã có via shadcn, hoạt động ổn)
- Animation/motion design (Framer Motion intro)
- Custom illustrations cho empty state
- Accessibility audit (WCAG AA)
- i18n full (hiện đang VN mix EN, không có lib formal)

## Success criteria

- Tất cả page dùng `<PageShell>` → consistent layout
- 0 inline "Đang tải..." text — dùng `<PageLoading>`
- Sidebar gọn (4 group thay vì 5)
- Grep `bg-emerald-500` chỉ tìm thấy trong success context, không trong voice
- Mobile UX: drawer toggle ở mọi nested page

---

## Execution order

Tôi sẽ làm tuần tự A → B → C. Mỗi batch xong sẽ báo bạn review trước khi qua batch tiếp.

### Tiến độ

- ✅ Batch A — page shell + empty/loading primitives + semantic color tokens (2026-05-14)
- ✅ Batch B — sidebar reorganize + collapsible + breadcrumb + form-to-dialog 4 page (2026-05-14)
- ✅ Batch C — cross-feature shortcuts + badge tokens + breadcrumb wire (2026-05-14)
- ✅ Batch D — Library + Practice hub consolidation (route groups) (2026-05-14)
- ✅ Batch E — Workspace-centric v1 (Notion/Quizlet pattern) (2026-05-14)

### Batch E — Workspace-centric v1

**Vấn đề**: /workspaces, /documents, /notes, /flashcards, /quizzes, /exams là
6 page rời nhau dù content thực tế liên quan (FC sinh từ doc của workspace).
"Khó kiểm soát + amateur".

**Pattern**: Notion + Quizlet — workspace là container chính, mọi content sống
bên trong. Workspace detail page có tabs cho mọi loại content.

**Schema migration 0022_workspace_centric.sql**:

- Add `workspace_id` (nullable, FK ON DELETE SET NULL) vào: `note`, `flashcard`,
  `quiz`, `exam` (`document` + `conversation` đã có sẵn)
- Composite indexes `(user_id, workspace_id)` cho query workspace-scoped nhanh
- Backfill: row hiện có → workspace đầu tiên của user (27 FC, 2 quiz, 6 exam)

**API endpoints scope theo workspace**:

- `/api/notes`, `/api/flashcards`, `/api/quiz`, `/api/exams`:
  - GET: `?workspaceId=X|null` filter
  - POST: nhận `workspaceId` từ body
- `/api/flashcards/generate`, `/api/quiz/generate`: auto-inherit workspaceId
  từ document nguồn
- `/api/workspaces/[id]/stats`: trả counts cho tab badges (mới)

**Workspace detail = tabbed hub** (`/workspaces/[id]`):

- 6 tabs: Overview | Documents | Notes | Flashcards | Quizzes | Exams
- URL state: `?tab=docs|notes|flashcards|quizzes|exams`
- Stats badges trên mỗi tab (số content)
- Header: name + edit/delete + breadcrumb (giữ giữa các tab)
- Overview tab: 5 stat cards click-to-tab + quick actions
- Mỗi tab có CTA tạo content scope workspace (vd "Tạo note" → POST với workspaceId)
- FC/Quiz generate trong tab inherit workspace từ doc nguồn

**Sidebar simplify**:

- LEARN: Workspaces, AI Tutor (2 mục) — bỏ Library hub
- PRACTICE: Practice (1 mục, hub: FC|Quiz|Exam|Plan cross-workspace, Anki pattern)
- Tổng: 11 → 9 mục sidebar

**Decisions từ user (3 questions)**:

- Flashcards review: global cross-workspace (Anki pattern)
- Notes scope workspace (nullable cho Personal), Study Plan stays global
- Migration backfill default = first workspace của user

**Cross-workspace views giữ lại** (top-level routes):

- `/documents`, `/notes` còn URL nhưng KHÔNG hiện trong sidebar
- Library tabs (Workspaces|Documents|Notes) ở top-level vẫn hoạt động — power
  user vào qua URL/bookmark; pattern chính qua workspace detail
- `/flashcards`, `/quiz`, `/exams` giữ làm "all" cross-workspace cho Practice hub

Typecheck pass clean.

### Batch D — Hub consolidation

**Vấn đề**: Sidebar 8 mục riêng cho Learn (4) + Practice (4) → rời rạc, "amateur".

**Pattern áp dụng**: Linear/Vercel/Notion-style — route groups + shared layout với tabs nav.

- URL giữ nguyên `/workspaces`, `/documents`, `/flashcards`... (không phá deep link nào)
- Folder gom vào `(library)/` và `(practice)/` route groups (parentheses → không xuất hiện trong URL)
- Layout `(library)/layout.tsx` + `(practice)/layout.tsx` render tabs nav phía trên content
- Tabs hiện chỉ ở top-level page (`/workspaces`, `/documents`, `/notes`); ẩn ở detail
  (`/workspaces/[id]`) — detail page dùng Breadcrumb thay thế

**Sidebar mới**:

- LEARN: Library (→ /workspaces) + AI Tutor (4 → 2 mục)
- PRACTICE: Practice (→ /flashcards) (4 → 1 mục)
- Tổng: 14 → 11 mục sidebar

**Active state mở rộng**: nav item hỗ trợ `match: string[]` để highlight đúng
khi user ở tab khác của cùng hub (vd ở /documents thì Library item vẫn active).

File structure:

```
app/(app)/
  (library)/
    layout.tsx          ← tabs nav: Workspaces | Documents | Notes
    workspaces/...
    documents/...
    notes/...
  (practice)/
    layout.tsx          ← tabs nav: Flashcards | Quizzes | Exams | Study Plan
    flashcards/...
    quiz/...
    exams/...
    study-plan/...
```

Typecheck pass clean.

### Batch C — kết quả

**Badge primitive** (`components/ui/badge.tsx`):

- Migrate hardcoded `emerald-500/15` `amber-500/15` → semantic tokens `success/15` `warning/15`
- Thêm variant `info` (blue) cho status không phải success/warning/destructive

**Cross-feature shortcuts**:

- **Document detail** (`documents/[id]`) → `DocumentDetailActions`:
  - "Hỏi AI Tutor" → `/chat/new`
  - "Flashcard" → mở `GenerateDialog` pre-select doc
  - "Quiz" → mở `QuizGenerateDialog` pre-select doc
  - Khi doc chưa READY (PROCESSING/FAILED) → ẩn 2 generate, chỉ giữ AI Tutor
- **Workspace detail** (`workspaces/[id]`):
  - "Hỏi AI Tutor về workspace" → `/chat/new?workspaceId=X`
  - "Tạo study group" → `CreateGroupDialog`
- **Note detail** (`notes/[id]`) → wire PageShell + Breadcrumb (back-link cũ remove)

**Component extensions**:

- `GenerateDialog` (flashcard): `initialDocId` + custom `trigger` prop
- `QuizGenerateDialog`: `initialDocId` + custom `trigger` prop
- Cả 2 dùng được standalone (như cũ) hoặc embedded từ document detail

**Color fixes**:

- `member-sidebar.tsx`: OWNER role `text-amber-500` → `text-warning`

**Out of scope (push qua phase sau)**:

- Note → Generate quiz (cần API mới `/api/quiz/from-note` — Notes chưa chunked/embedded)
- Mobile drawer unified Sheet pattern (sidebar đã có drawer; các page nested không bắt buộc)

Typecheck pass clean (6 packages turbo).

### Batch B — kết quả

**Sidebar** (`apps/web/src/components/app/sidebar.tsx`):

- Merge 5 group → 4: `SPACES` (1 mục) → gộp vào `SOCIAL`
- Collapsible sections: click section header → fold; state persist localStorage
  (`cogniva.sidebar.collapsed`). Auto-bung section chứa active item kể cả khi user
  đã fold trước đó.
- "Tin nhắn" → "Messages" cho consistent VN/EN

**Breadcrumbs** (`components/layout/breadcrumbs.tsx`):

- Component reusable với 2 mode: auto (segments array) hoặc children custom.
- Wire vào `workspaces/[id]` thay back-link cũ.

**Form-to-Dialog (4 page)** — thay pattern `showForm` inline toggle/dropzone to:

- `/workspaces` → `CreateWorkspaceDialog`
- `/groups` → `CreateGroupDialog` + `JoinGroupDialog` (gộp 2 card inline thành 2 button trigger)
- `/study-plan` → `CreateStudyItemDialog`
- `/documents` → `UploadDocumentDialog` + `DocumentDropOverlay`
  - Dialog: button "+ Upload" header
  - Overlay: kéo file vào bất kỳ đâu trên page → full-page overlay → thả → upload
  - Logic upload tách hook `useDocumentUpload` chia sẻ giữa Dialog + Overlay
  - Empty state có CTA "Upload PDF đầu tiên" — trigger cùng dialog

Typecheck pass clean (6 packages turbo).

### Batch A — kết quả

**Primitives mới** (`apps/web/src/components/layout/`):

- `PageShell` — wrapper layout chuẩn (title/description/action header + size 'narrow'|'default'|'wide'|'full')
- `EmptyState` — placeholder rỗng (variant 'dashed'|'card'|'inline')
- `PageLoading` — loading state (variant 'spinner'|'skeleton'|'card')

**Semantic color tokens** (`tailwind.config.ts`):

- `voice-active` (indigo), `voice-mute` (red), `stage-host` (rose), `forum` (emerald),
  `recording-live` (red), `success` (emerald), `warning` (amber)

**Pages migrated sang PageShell** (14 file):
documents, dashboard, chat, rooms, workspaces, profile, settings, notes, flashcards,
quiz, exams, exams/new, analytics, study-plan, leaderboard, groups, rooms/[id]/recordings.

**Empty patterns replaced** (~10 chỗ): tất cả "Card border-dashed + title" và inline
"Chưa có ..." card đã chuyển sang `<EmptyState>`. Loading inline text đã thay bằng
`<PageLoading variant="skeleton">`.

**Color fixes** (Batch C scope sớm):

- `voice-stage.tsx`, `stage-channel.tsx`: mic on `bg-emerald-500` → `bg-voice-active`
- `profile.tsx`: public badge `emerald` → `success` token
- `groups/page.tsx`: OWNER role `amber-500` → `warning` token

Typecheck pass clean.
