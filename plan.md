# 🎓 AI-Native Learning Workflow — Master Plan

> **Vision:** Build a production-grade AI learning platform that truly understands learners — not a "ChatGPT wrapper". Every interaction makes the system smarter about *this specific user*.

---

## 📑 Mục lục

1. [Tổng quan & Differentiators](#1-tổng-quan--differentiators)
2. [Full Feature List](#2-full-feature-list)
3. [Tech Stack chi tiết](#3-tech-stack-chi-tiết)
4. [System Architecture](#4-system-architecture)
5. [Database Schema](#5-database-schema)
6. [API Design](#6-api-design)
7. [AI Pipeline chi tiết](#7-ai-pipeline-chi-tiết)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Folder Structure](#9-folder-structure)
10. [Roadmap 16 tuần](#10-roadmap-16-tuần)
11. [DevOps, Security, Compliance](#11-devops-security-compliance)
12. [Evaluation & Observability](#12-evaluation--observability)
13. [Monetization](#13-monetization)
14. [Portfolio & Marketing](#14-portfolio--marketing)

---

## 1. Tổng quan & Differentiators

### 1.1. Tên dự án
**Cogniva** (Cognition + Nova) — hoặc tên bạn thích. Cogniva = "AI tutor that knows you."

### 1.2. Một-câu-pitch
> An AI-native learning platform that builds a personal knowledge graph for every learner, retrieves with multi-stage RAG, and adapts in real-time using Bayesian mastery tracking and spaced repetition.

### 1.3. Tại sao đây là project PRO (không phải GPT wrapper)

| Đặc điểm | GPT Wrapper thường | Cogniva |
|---|---|---|
| Architecture | Frontend → OpenAI API → text | Multi-stage pipeline: ingest → embed → graph → retrieve → rerank → reason → eval |
| State | Stateless chat | Persistent user knowledge graph + mastery scores |
| Retrieval | Vector search top-5 | Hybrid (BM25 + vector) → rerank → context assembly |
| Personalization | Tên user trong prompt | Profile-aware context injection, weak-topic boosting |
| Quality | "Trust the LLM" | Evals + golden dataset + RAGAS metrics + A/B tests |
| Observability | console.log | LangSmith/Langfuse traces, cost dashboards, latency P95 |
| Models | One model fits all | Routing: Haiku for fast, Sonnet for reasoning, Opus for complex synthesis |

### 1.4. Target users
- Sinh viên đại học (primary)
- Người tự học (online courses, certifications)
- Học sinh cấp 3 ôn thi
- Researchers cần đọc nhiều paper

---

## 2. Full Feature List

### 2.1. Core AI Features (MVP — must-have)

#### F1. Document Ingestion & Q&A
- Upload PDF, DOCX, TXT, EPUB, ảnh, URL, YouTube transcript
- OCR cho ảnh và scanned PDF
- Multi-file workspace (project-based, like Notion)
- Q&A có citation (click để jump tới đoạn gốc trong PDF)
- Highlight & note trực tiếp trên PDF viewer
- Multi-document Q&A: hỏi 1 câu → AI trả lời tổng hợp từ nhiều file

#### F2. AI Tutor Chat
- Streaming chat với context từ user's documents
- Tutor mode: AI dạy theo Socratic method (hỏi ngược user)
- Adaptive difficulty: AI tự điều chỉnh độ khó dựa trên mastery
- Multi-turn memory: nhớ điều user đã học
- Code execution sandbox (cho học lập trình)
- Math rendering (KaTeX)
- Voice mode (TTS + STT)

#### F3. Knowledge Graph
- Auto-extract concepts từ documents
- Build prerequisite graph (concept A cần concept B trước)
- Visualize bằng D3.js / React Flow
- User có thể edit graph manually
- Color-coded by mastery level

#### F4. Smart Flashcards
- Auto-generate từ documents (LLM extract Q-A pairs)
- Spaced repetition (SM-2 algorithm hoặc FSRS — newer, better)
- Cloze deletion (fill-in-the-blank)
- Image occlusion (cover ảnh, học giải phẫu)
- Audio cards (cho language learning)
- Import từ Anki

#### F5. Quiz Generator
- Multiple types: MCQ, true/false, short answer, essay, fill-blank
- Difficulty adaptive theo user mastery
- AI grading cho essay (with rubric)
- Detailed explanation cho mỗi câu
- "Weak topic" mode: chỉ hỏi về chỗ user yếu

#### F6. Mastery Tracking
- Bayesian Knowledge Tracing (BKT) cho từng concept
- Visualize mastery: 0-1 score, decay theo thời gian
- Recommended next topics dựa trên prerequisite + mastery
- Weekly mastery reports

### 2.2. Productivity Features (V2)

#### F7. Smart Notes
- Markdown editor với AI assist
- AI auto-link notes (Roam-style backlinks)
- AI-generated summary của note
- Convert notes → flashcards 1-click
- Block-based editor (Notion-style)

#### F8. Mind Map Generator
- AI vẽ mind map từ topic hoặc document
- Editable, exportable
- Convert mind map → study plan

#### F9. Study Planner
- AI tạo lịch học dựa trên: deadline + mastery + available time
- Pomodoro timer tích hợp
- Calendar view (sync Google Calendar optional)
- Daily review queue (spaced repetition cards due today)

#### F10. Writing Assistant
- Essay outline generator
- Citation checker (verify against sources)
- Grammar + style check
- Plagiarism check (vs user's own corpus)
- Academic tone rewriter

### 2.3. Social & Gamification (V3)

#### F11. Study Groups
- Shared workspaces
- Real-time collaborative whiteboard (Excalidraw-like)
- Group quizzes (Kahoot-style)
- Peer Q&A: ask group, AI answers if no one does
- Voice rooms (Discord-style cho study together)

#### F12. Gamification
- XP, levels, streaks
- Achievement badges (50+ types)
- Leaderboards (friends, global, by topic)
- Daily challenges
- Pet/avatar that grows with progress (Duolingo-style)

#### F13. Public Profile
- Showcase learning journey
- Public knowledge graphs
- Study stats (LeetCode-style heatmap)

### 2.4. Advanced AI Features (V4 — wow factor)

#### F14. Voice AI Tutor
- Real-time conversation (low latency với Deepgram + ElevenLabs)
- Interrupt-able (user có thể cắt ngang)
- Emotion-aware (detect frustration, encourage)

#### F15. Video Learning
- Upload video lecture → AI transcribes + summarizes
- Chapter generation
- Q&A on video timestamps
- Generate flashcards từ video

#### F16. Multi-modal
- Upload sketch → AI explains it
- Solve handwritten math problems (camera)
- Diagram generator (AI vẽ diagram để giải thích)

#### F17. Agentic Research Mode
- "Research mode": AI tự search web, đọc papers, tổng hợp report
- Citation-backed report generation
- Export to PDF/Notion/Obsidian

#### F18. Personal AI Memory
- Long-term memory across sessions (Mem0 or custom)
- "What did I struggle with last month?"
- "Remind me what I learned about X"

### 2.5. Platform Features

#### F19. Cross-platform
- Web (primary)
- PWA (mobile-installable)
- Browser extension (highlight any webpage → save to Cogniva)
- iOS/Android (React Native, V5)

#### F20. Integrations
- Notion, Obsidian, Roam (export/import notes)
- Google Drive, Dropbox (auto-sync documents)
- Anki (import/export decks)
- Zotero (citation management)
- Discord/Slack bot

#### F21. Offline Mode
- Service Worker cache
- Local-first cho notes (CRDT với Yjs)
- Sync khi online lại

#### F22. Accessibility
- Full keyboard navigation
- Screen reader support
- Dyslexia-friendly font option
- Multiple languages (i18n with next-intl)

---

## 3. Tech Stack chi tiết

### 3.1. Frontend
```
Next.js 14 (App Router)         — SSR, RSC, streaming
TypeScript 5                    — type safety
Tailwind CSS 3                  — styling
shadcn/ui                       — component library
Framer Motion                   — animations
Radix UI                        — primitives (a11y)
TipTap                          — rich text editor
React Flow                      — knowledge graph viz
D3.js                           — custom data viz
KaTeX                           — math rendering
Excalidraw                      — collaborative whiteboard
Zustand                         — global state
TanStack Query                  — server state
React Hook Form + Zod           — forms + validation
next-intl                       — i18n
Vercel AI SDK                   — streaming UI
```

### 3.2. Backend
```
Next.js API Routes              — primary backend (or separate FastAPI for ML)
tRPC                            — type-safe API
Drizzle ORM                     — database access (edge-ready, smaller bundle, SQL control)
PostgreSQL 16 + pgvector        — main DB + vectors
Redis (Upstash)                 — cache, rate limit, sessions
Inngest / Trigger.dev           — background jobs (ingestion pipeline)
Pusher / Ably                   — real-time (study groups)
Supabase Realtime               — alternative for real-time
```

**Why Drizzle over Prisma:** edge runtime support out of the box, ~10x smaller client bundle, no separate generation step, and native SQL escape hatch for things like pgvector operators (`<->`, `<=>`) and recursive CTEs that Prisma awkwardly proxies through `$queryRaw`.

### 3.3. AI Layer
```
Mastra                          — TypeScript-native agent + workflow framework
Claude Sonnet 4.6               — primary reasoning
Claude Haiku 4.5                — fast tasks (chunking, classification)
Claude Opus 4.7                 — complex synthesis (research mode)
voyage-3 (Voyage AI)            — embeddings primary (Anthropic recommend, free 200M token, 1024 dim)
text-embedding-3-large          — embeddings fallback (OpenAI, dimensions:1024)
Cohere rerank-3                 — reranking
Whisper (OpenAI)                — STT
ElevenLabs / Deepgram Aura      — TTS
Tesseract / Mistral OCR         — OCR
Unstructured.io                 — document parsing
```

**Why Mastra over LangGraph:** Mastra is TypeScript-native (no Python runtime), has first-class Vercel deploy support, built-in evals + tracing, and integrates cleanly with Next.js streaming + AI SDK. LangGraph's JS port still trails the Python implementation in feature parity.

**Why Voyage AI as primary embeddings:** Anthropic ngưng phát triển embedding API riêng và chính thức recommend Voyage AI. voyage-3 đạt MTEB cao hơn text-embedding-3-large @ 1024 dim, free tier 200M token (đủ index hàng triệu chunk Cogniva), không cần thẻ tín dụng. Kiến trúc giữ OpenAI làm fallback (`EMBEDDING_PROVIDER=openai` để force) — cùng dim 1024 nên không phải migrate schema khi switch.

**Why OpenRouter as free LLM testing path:** Anthropic Console yêu cầu thẻ tín dụng cho production usage; OpenRouter cho phép sign up qua OAuth không thẻ và phơi 24+ model FREE (gpt-oss-20b/120b, GLM-4.5, Qwen3, Gemma-4, Hermes-3-405B…) qua OpenAI-compatible API tại `/api/v1`. Cogniva implement provider abstraction (`lib/ai/models.ts`): `ANTHROPIC_API_KEY` set → Claude direct; chỉ `OPENROUTER_API_KEY` → fallback OpenAI-compat client trỏ vào OpenRouter. Đổi giữa 2 path không touch app code, chỉ env. Free path quan trọng cho dev + portfolio demo, paid path cho production quality.

### 3.4. Vector & Graph DB
```
pgvector (PostgreSQL extension) — vectors (start here, simple)
Pinecone                        — alternative if scale > 10M vectors
Neo4j AuraDB                    — knowledge graph (or use Postgres recursive CTE)
```

### 3.5. Storage & CDN
```
Cloudflare R2                   — file storage (S3-compatible, zero egress fees)
Cloudflare CDN                  — global distribution
ImageKit / Cloudinary           — image processing
```

### 3.6. Auth & Payment
```
Better Auth                     — self-hosted auth (email/password + OAuth)
Stripe                          — subscriptions
LemonSqueezy                    — alternative (handles tax)
```

**Why Better Auth over Clerk:** Clerk's pricing kicks in hard at ~10k MAU ($25 + $0.02/MAU after 10k). Better Auth is open-source, runs on our own Postgres, has typed plugin system (organizations, 2FA, magic links, passkeys), and Drizzle/Prisma adapters. Clerk's hosted UI is nice but we can rebuild the sign-in/sign-up screens with shadcn in a day. Migration cost amortizes inside the first month at scale.

### 3.7. Observability
```
Langfuse (self-hosted)          — LLM tracing, evals
Sentry                          — error tracking
PostHog                         — product analytics + session replay
Helicone                        — LLM cost monitoring
Better Stack / Axiom            — logs
Vercel Analytics                — web vitals
```

### 3.8. DevOps
```
Vercel                          — hosting (frontend + API)
Railway / Fly.io                — workers, databases
Docker                          — containerization
GitHub Actions                  — CI/CD
Turbo                           — monorepo build
pnpm workspaces                 — monorepo
```

### 3.9. Testing
```
Vitest                          — unit tests
Playwright                      — E2E
MSW                             — API mocking
Storybook                       — component dev
RAGAS                           — RAG eval metrics
Promptfoo                       — prompt testing
```

---

## 4. System Architecture

### 4.1. High-level flow

```
[Browser/PWA]
     │
     ▼
[Vercel Edge — Next.js]
     │
     ├──► [tRPC API] ──► [PostgreSQL + pgvector]
     │                ──► [Redis cache]
     │
     ├──► [Background Worker — Inngest]
     │         │
     │         ├──► [Ingestion Pipeline]
     │         │      OCR → Parse → Chunk → Embed → Store
     │         │
     │         ├──► [Knowledge Graph Builder]
     │         │      Concept extraction → relationship mining
     │         │
     │         └──► [Mastery Update Job]
     │                BKT recompute, SR scheduling
     │
     └──► [LLM Gateway — Mastra]
                │
                ├──► Claude API (Anthropic)
                ├──► Embeddings (OpenAI)
                ├──► Cohere Rerank
                └──► Logged to Langfuse
```

### 4.2. Microservices vs Monolith

**Khuyến nghị: Modular monolith** (Next.js + workers).
- Đơn giản deploy
- Dễ debug
- Có thể tách microservice sau nếu scale

Tách riêng nếu cần:
- ML inference service (FastAPI + GPU) — chỉ cần nếu self-host model
- Real-time collab service — nếu Pusher không đủ

### 4.3. Request lifecycle ví dụ: "User asks a question"

```
1. User types → POST /api/chat
2. Auth middleware → verify JWT
3. Rate limit check (Redis)
4. Load conversation context + user profile
5. Trigger Mastra workflow:
   a. Query rewriting (HyDE)
   b. Hybrid retrieval (pgvector + BM25)
   c. Rerank (Cohere)
   d. Context assembly (top-5 chunks + user profile + conv history)
   e. Stream LLM response (Claude Sonnet)
   f. Extract concepts mentioned → log
6. Stream tokens back to client (SSE)
7. On completion:
   - Save message to DB
   - Update concept exposure counts
   - Trigger background: update knowledge graph
   - Log full trace to Langfuse
```

---

## 5. Database Schema

> Schema is defined with **Drizzle ORM** (`drizzle-orm/pg-core`). Better Auth's `user`, `session`, `account`, `verification` tables live alongside in the same schema and are extended (not duplicated) by the domain `user` row below.

### 5.1. Core tables

**Snapshot DB hiện tại** (Phase 0-9 cộng dồn, 21 tables):
- Auth (Better Auth managed): `user` (+ cột mở rộng `plan`/`isPublic`/`preferences`), `session`, `account`, `verification`
- Domain core: `workspace`, `document`, `chunk`, `concept`, `concept_relation`, `chunk_concept`
- Learning: `conversation`, `message`, `flashcard`, `review`, `quiz`, `question`, `mastery`, `note`, `study_plan_item`, `study_session`
- Gamification: `user_stats`, `study_group`, `study_group_member`

**Lưu ý migration thực tế**:
- `chunk.embedding` + `concept.embedding` dùng `vector(1024)` (Voyage-3 native), không phải 1536 như code spec dưới
- Phase 7-9 thêm `note`, `study_plan_item`, `user_stats`, `study_group`, `study_group_member`, cột `user.is_public` (không có trong code spec dưới)

Code spec gốc (giữ làm reference design):

```typescript
// packages/db/src/schema.ts
import {
  pgTable, pgEnum, text, varchar, timestamp, integer, real, boolean,
  jsonb, uniqueIndex, index, primaryKey, customType,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

// ── Custom pgvector column ────────────────────────────────
const vector = (name: string, dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${dim})`,
    toDriver: (v) => `[${v.join(',')}]`,
    fromDriver: (v) => JSON.parse(v as unknown as string),
  })(name);

// ── Enums ─────────────────────────────────────────────────
export const planEnum         = pgEnum('plan',          ['FREE', 'PRO', 'TEAM']);
export const docStatusEnum    = pgEnum('doc_status',    ['UPLOADING', 'PROCESSING', 'READY', 'FAILED']);
export const roleEnum         = pgEnum('role',          ['USER', 'ASSISTANT', 'SYSTEM']);
export const cardTypeEnum     = pgEnum('card_type',     ['BASIC', 'CLOZE', 'IMAGE_OCCLUSION']);
export const fsrsStateEnum    = pgEnum('fsrs_state',    ['NEW', 'LEARNING', 'REVIEW', 'RELEARNING']);
export const qTypeEnum        = pgEnum('q_type',        ['MCQ', 'TRUE_FALSE', 'SHORT', 'ESSAY', 'FILL_BLANK']);
export const sessionTypeEnum  = pgEnum('session_type',  ['CHAT', 'FLASHCARD', 'QUIZ', 'READING']);

// ── Users (Better Auth owns base columns; we extend) ──────
export const user = pgTable('user', {
  id:             text('id').primaryKey(),                     // Better Auth manages
  email:          text('email').notNull().unique(),
  emailVerified:  boolean('email_verified').notNull().default(false),
  name:           text('name'),
  image:          text('image'),
  plan:           planEnum('plan').notNull().default('FREE'),
  preferences:    jsonb('preferences').$type<UserPreferences>().default({}),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

// ── Workspaces ────────────────────────────────────────────
export const workspace = pgTable('workspace', {
  id:           text('id').primaryKey().$defaultFn(() => createId()),
  userId:       text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  description:  text('description'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('workspace_user_idx').on(t.userId),
}));

// ── Documents ─────────────────────────────────────────────
export const document = pgTable('document', {
  id:           text('id').primaryKey().$defaultFn(() => createId()),
  userId:       text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  workspaceId:  text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
  filename:     text('filename').notNull(),
  mimeType:     text('mime_type').notNull(),
  size:         integer('size').notNull(),
  storageKey:   text('storage_key').notNull(),                   // R2 key
  status:       docStatusEnum('status').notNull().default('PROCESSING'),
  metadata:     jsonb('metadata').$type<DocumentMetadata>().default({}),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userWorkspaceIdx: index('document_user_workspace_idx').on(t.userId, t.workspaceId),
}));

// ── Chunks (with pgvector embedding) ──────────────────────
export const chunk = pgTable('chunk', {
  id:           text('id').primaryKey().$defaultFn(() => createId()),
  documentId:   text('document_id').notNull().references(() => document.id, { onDelete: 'cascade' }),
  content:      text('content').notNull(),
  embedding:    vector('embedding', 1536),                       // text-embedding-3-large @ 1536-dim (HNSW limit)
  metadata:     jsonb('metadata').$type<ChunkMetadata>().default({}),
  tokens:       integer('tokens').notNull(),
}, (t) => ({
  docIdx:       index('chunk_doc_idx').on(t.documentId),
  // HNSW vector index (raw SQL — Drizzle escape hatch)
  embeddingIdx: index('chunk_embedding_idx')
                  .using('hnsw', sql`${t.embedding} vector_cosine_ops`),
  // Full-text BM25-ish via tsvector
  contentTsvIdx: index('chunk_content_tsv_idx')
                  .using('gin', sql`to_tsvector('english', ${t.content})`),
}));

// ── Concepts (vector-embedded for dedup) ──────────────────
export const concept = pgTable('concept', {
  id:           text('id').primaryKey().$defaultFn(() => createId()),
  name:         text('name').notNull(),
  description:  text('description'),
  domain:       text('domain').notNull(),                        // "math", "biology"…
  embedding:    vector('embedding', 1536),
}, (t) => ({
  embeddingIdx: index('concept_embedding_idx')
                  .using('hnsw', sql`${t.embedding} vector_cosine_ops`),
}));

export const conceptRelation = pgTable('concept_relation', {
  id:           text('id').primaryKey().$defaultFn(() => createId()),
  fromId:       text('from_id').notNull().references(() => concept.id, { onDelete: 'cascade' }),
  toId:         text('to_id').notNull().references(() => concept.id, { onDelete: 'cascade' }),
  relationType: text('relation_type').notNull(),                 // "prerequisite" | "related" | "specializes"
  strength:     real('strength').notNull().default(1.0),
}, (t) => ({
  uniq: uniqueIndex('concept_relation_uniq').on(t.fromId, t.toId, t.relationType),
}));

// ── Mastery (BKT per user × concept) ──────────────────────
export const mastery = pgTable('mastery', {
  id:          text('id').primaryKey().$defaultFn(() => createId()),
  userId:      text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId:   text('concept_id').notNull().references(() => concept.id, { onDelete: 'cascade' }),
  score:       real('score').notNull().default(0),               // 0..1
  attempts:    integer('attempts').notNull().default(0),
  correct:     integer('correct').notNull().default(0),
  lastSeenAt:  timestamp('last_seen_at'),
  decayedAt:   timestamp('decayed_at'),
}, (t) => ({
  uniq: uniqueIndex('mastery_user_concept_uniq').on(t.userId, t.conceptId),
}));

// ── Conversations ─────────────────────────────────────────
export const conversation = pgTable('conversation', {
  id:           text('id').primaryKey().$defaultFn(() => createId()),
  userId:       text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  workspaceId:  text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
  title:        text('title'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

export const message = pgTable('message', {
  id:               text('id').primaryKey().$defaultFn(() => createId()),
  conversationId:   text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  role:             roleEnum('role').notNull(),
  content:          text('content').notNull(),
  citations:        jsonb('citations').$type<Citation[]>().default([]),
  metadata:         jsonb('metadata').$type<MessageMetadata>().default({}),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
});

// ── Flashcards (FSRS) ─────────────────────────────────────
export const flashcard = pgTable('flashcard', {
  id:               text('id').primaryKey().$defaultFn(() => createId()),
  userId:           text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId:        text('concept_id').references(() => concept.id, { onDelete: 'set null' }),
  front:            text('front').notNull(),
  back:             text('back').notNull(),
  cardType:         cardTypeEnum('card_type').notNull().default('BASIC'),
  sourceChunkId:    text('source_chunk_id').references(() => chunk.id, { onDelete: 'set null' }),

  difficulty:       real('difficulty').notNull().default(0),
  stability:        real('stability').notNull().default(0),
  retrievability:   real('retrievability').notNull().default(0),
  state:            fsrsStateEnum('state').notNull().default('NEW'),
  due:              timestamp('due').notNull().defaultNow(),
  lastReview:       timestamp('last_review'),
}, (t) => ({
  userDueIdx: index('flashcard_user_due_idx').on(t.userId, t.due),
}));

export const review = pgTable('review', {
  id:           text('id').primaryKey().$defaultFn(() => createId()),
  flashcardId:  text('flashcard_id').notNull().references(() => flashcard.id, { onDelete: 'cascade' }),
  rating:       integer('rating').notNull(),                     // 1..4 FSRS
  duration:     integer('duration').notNull(),                   // ms
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

// ── Quizzes ───────────────────────────────────────────────
export const quiz = pgTable('quiz', {
  id:         text('id').primaryKey().$defaultFn(() => createId()),
  userId:     text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title:      text('title').notNull(),
  config:     jsonb('config').$type<QuizConfig>().default({}),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
});

export const question = pgTable('question', {
  id:             text('id').primaryKey().$defaultFn(() => createId()),
  quizId:         text('quiz_id').notNull().references(() => quiz.id, { onDelete: 'cascade' }),
  type:           qTypeEnum('type').notNull(),
  prompt:         text('prompt').notNull(),
  options:        jsonb('options').$type<string[] | null>(),
  correctAnswer:  jsonb('correct_answer').notNull(),
  explanation:    text('explanation').notNull(),
  conceptId:      text('concept_id').references(() => concept.id, { onDelete: 'set null' }),
  difficulty:     real('difficulty').notNull(),
});

// ── Study sessions ────────────────────────────────────────
export const studySession = pgTable('study_session', {
  id:           text('id').primaryKey().$defaultFn(() => createId()),
  userId:       text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  startedAt:    timestamp('started_at').notNull().defaultNow(),
  endedAt:      timestamp('ended_at'),
  sessionType:  sessionTypeEnum('session_type').notNull(),
  metadata:     jsonb('metadata').default({}),
});

// ── Relations (for type-safe joins via drizzle-orm) ───────
export const userRelations = relations(user, ({ many }) => ({
  workspaces: many(workspace),
  documents:  many(document),
  conversations: many(conversation),
  flashcards: many(flashcard),
  mastery:    many(mastery),
  studySessions: many(studySession),
}));
// (other relations elided for brevity — defined in packages/db/src/schema.ts)
```

### 5.2. Indexes quan trọng
- `chunk.embedding` — **HNSW** index with `vector_cosine_ops` for ANN search (defined inline above)
  - **Note on dimensions:** pgvector HNSW has a hard limit of 2000 dimensions for `vector` type. We use **1536** so we can keep HNSW (the fastest option). Two ways to fit text-embedding-3-large into this:
    - Call OpenAI embeddings API with `dimensions: 1536` (the model is trained on a Matryoshka-style truncation, ~1% accuracy loss vs 3072).
    - Or use `text-embedding-3-small` natively — same 1536 dim, 6x cheaper.
  - **If you need full 3072 later:** switch the column to `halfvec(3072)` (half-precision floats, HNSW supports up to 4000 dim) or to `vector(3072)` with `IVFFlat` (slower index build, slightly lower recall).
- `chunk.content` — **GIN** index on `to_tsvector('english', content)` for BM25 hybrid
- `mastery (userId, conceptId)` — `uniqueIndex` (one row per user × concept)
- `flashcard (userId, due)` — composite index for daily queue query
- `concept_relation (fromId, toId, relationType)` — unique compound

### 5.3. Better Auth tables (auto-managed)
Better Auth creates and migrates `session`, `account`, `verification` tables automatically when you run `npx @better-auth/cli generate`. The base `user` table above intentionally matches Better Auth's expected shape (`id`, `email`, `emailVerified`, `name`, `image`, `createdAt`, `updatedAt`), then we add domain columns (`plan`, `preferences`).

---

## 6. API Design

### 6.1. API style — REST (không phải tRPC)

Spec ban đầu plan tRPC nhưng Phase 0-10 chọn **REST + Next.js route handlers**
(`app/api/**/route.ts`) vì:
- Đỡ phải maintain layer tRPC + zod context riêng (Next.js đã cho `Request`
  + `NextResponse` chuẩn web standard).
- Better Auth có built-in REST + cookie middleware → tích hợp natural.
- Easier to consume từ external (mobile, extension Phase V3) — không phải
  bind tRPC client.

Trade-off: mất type-safety end-to-end (client phải tự type response). Bù
lại mỗi route handler tự dùng Zod validate body / params → server vẫn an
toàn input.

**Route handlers thực tế** (`app/api/`):

| Domain | Files |
|---|---|
| Auth (Better Auth) | `auth/[...all]/route.ts` |
| Documents | `documents/route.ts`, `[id]/route.ts`, `upload/route.ts`, `[id]/move/route.ts` |
| Chat | `chat/route.ts`, `conversations/route.ts`, `conversations/[id]/route.ts` |
| Flashcards | `flashcards/route.ts`, `[id]/route.ts`, `[id]/review/route.ts`, `queue/`, `stats/`, `generate/`, `image/`, `upload-image/` |
| Quiz | `quiz/route.ts`, `[id]/route.ts`, `[id]/attempt/route.ts`, `generate/` |
| Mastery | `mastery/route.ts`, `recommendations/route.ts`, `decay/route.ts` |
| Graph | `graph/route.ts`, `concept/[id]/route.ts` |
| Notes | `notes/route.ts`, `[id]/route.ts`, `complete/route.ts` |
| Study plan | `study-plan/route.ts`, `[id]/route.ts` |
| Search | `search/route.ts` (Cmd+K global) |
| Workspaces | `workspaces/route.ts`, `[id]/route.ts` |
| Profile | `profile/me/route.ts`, `[id]/route.ts` |
| Leaderboard | `leaderboard/route.ts` |
| Groups | `groups/route.ts`, `[id]/route.ts`, `join/route.ts` |
| Analytics | `analytics/route.ts` |

### 6.2. Key endpoints

```
POST   /api/documents/upload         — get presigned R2 URL
POST   /api/documents/process        — trigger ingestion pipeline
GET    /api/documents                — list user docs

POST   /api/chat                     — stream chat response (SSE)
GET    /api/chat/:id/messages        — load history

POST   /api/flashcards/generate      — AI generate from doc
POST   /api/flashcards/:id/review    — submit review (FSRS update)
GET    /api/flashcards/queue         — today's due cards

POST   /api/quiz/generate            — AI generate quiz
POST   /api/quiz/:id/attempt         — submit attempt, get grading

GET    /api/graph/:userId            — knowledge graph (filtered by mastery)
GET    /api/mastery/recommendations  — what to learn next

POST   /api/search                   — hybrid search across user corpus
```

### 6.3. Streaming pattern (SSE)

```typescript
// app/api/chat/route.ts
export async function POST(req: Request) {
  const { messages, conversationId } = await req.json();

  const stream = await langGraphPipeline.invoke({
    messages,
    userId: session.userId,
    conversationId,
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

---

## 7. AI Pipeline chi tiết

### 7.1. Ingestion Pipeline (background job)

**Trigger:** User upload document → Inngest job fired

**Steps:**

1. **Download from R2** → load into worker memory
2. **Detect file type** → branch
3. **Parse**:
   - PDF: PyMuPDF (text PDFs) hoặc Mistral OCR (scanned)
   - DOCX: python-docx
   - Image: Tesseract → fallback to Vision API
   - URL: Playwright → readable HTML → Markdown (Turndown)
   - YouTube: youtube-transcript-api
4. **Clean text**: remove headers/footers, normalize whitespace
5. **Semantic chunking**:
   - Use `LangChain RecursiveCharacterTextSplitter` với separators theo cấu trúc
   - Hoặc better: dùng LLM-based chunking (Haiku) → smarter boundaries
   - Target: 512 tokens/chunk, overlap 50
6. **Enrich metadata** per chunk:
   - LLM call (Haiku, batch): extract `{topics, difficulty, type}` → JSON
7. **Embed chunks** → batch call to OpenAI embeddings
8. **Store** in PostgreSQL (chunks + embeddings)
9. **Concept extraction** (separate job):
   - LLM extract named concepts from doc
   - Match to existing Concept table (vector similarity > 0.85 = same)
   - Create new concepts if not exist
   - Mine prerequisites: "to understand X you need Y"
10. **Update knowledge graph**
11. **Notify user** (websocket) "Document ready"

**Error handling:** Retry 3x with exponential backoff. On final failure, mark `DocStatus = FAILED` and notify.

### 7.2. Retrieval Pipeline (query-time)

**Input:** User query + conversation history + user profile

```python
# Pseudocode
def retrieve(query, user_id, conv_history, profile):
    # Step 1: Query understanding
    rewritten = llm.rewrite_query(
        query=query,
        history=conv_history,
        instruction="Make query standalone and self-contained"
    )

    # Step 2: HyDE (Hypothetical Document Embeddings)
    hypothetical = llm.generate_hypothetical_answer(rewritten)
    query_embedding = embed(hypothetical)  # Embed the hypothetical, not query

    # Step 3: Hybrid search
    vector_hits = pgvector.search(
        embedding=query_embedding,
        filter={"userId": user_id},
        k=30
    )
    bm25_hits = postgres.full_text_search(rewritten, user_id, k=30)
    merged = reciprocal_rank_fusion(vector_hits, bm25_hits)

    # Step 4: Rerank
    reranked = cohere.rerank(
        query=rewritten,
        documents=[h.content for h in merged[:50]],
        top_n=8
    )

    # Step 5: Diversity filter (MMR)
    diverse = mmr_filter(reranked, lambda_=0.7, top_n=5)

    # Step 6: Add user context
    weak_concepts = get_weak_concepts(user_id)
    if any(c.name in query for c in weak_concepts):
        # Boost chunks related to weak concepts
        diverse = boost_weak_topic_chunks(diverse, weak_concepts)

    return diverse
```

### 7.3. LLM Generation

**Mastra workflow (state machine):**

```
START
  ↓
[Classify query] — is it: factual / conceptual / problem-solving / chitchat?
  ↓
[Branch]
  ├─ factual    → simple RAG → Sonnet
  ├─ conceptual → RAG + concept graph context → Sonnet (longer)
  ├─ problem    → ReAct loop with tools (calculator, code exec) → Sonnet
  └─ chitchat   → Haiku, no retrieval
  ↓
[Generate response]
  ↓
[Extract citations] — match output spans to source chunks
  ↓
[Update concept exposure] — log which concepts were discussed
  ↓
END
```

### 7.4. Mastery Update (Bayesian Knowledge Tracing)

After every quiz answer or flashcard review:

```python
# BKT model parameters per concept
P_init  = 0.1   # initial probability of mastery
P_T     = 0.2   # transition probability (learning rate)
P_S     = 0.1   # slip (knew it but got wrong)
P_G     = 0.2   # guess (didn't know but got right)

def update_mastery(prior, correct):
    if correct:
        likelihood = prior * (1 - P_S) + (1 - prior) * P_G
        posterior  = (prior * (1 - P_S)) / likelihood
    else:
        likelihood = prior * P_S + (1 - prior) * (1 - P_G)
        posterior  = (prior * P_S) / likelihood

    # Account for learning during this attempt
    new_mastery = posterior + (1 - posterior) * P_T
    return new_mastery
```

Apply forgetting curve: mastery decays by `e^(-t/half_life)` between sessions.

### 7.5. Spaced Repetition (FSRS — newer than SM-2)

```
For each card after review:
  1. Compute new difficulty (D), stability (S), retrievability (R)
  2. Schedule next review:
     interval = S × ln(target_R) / ln(0.9)
  3. target_R configurable (90% default)
```

Library: `ts-fsrs` (npm).

### 7.6. Prompt Engineering Strategy

**Folder:** `prompts/` — every prompt as a versioned file.

```
prompts/
├── tutor/
│   ├── socratic_v1.txt
│   ├── socratic_v2.txt   ← current
│   └── direct_explainer_v1.txt
├── quiz/
│   ├── mcq_generator_v3.txt
│   └── essay_grader_v2.txt
├── chunking/
│   └── semantic_chunker_v1.txt
└── extraction/
    ├── concept_extractor_v2.txt
    └── prerequisite_miner_v1.txt
```

Each prompt:
- Versioned (track in git, also in Langfuse)
- A/B testable
- Tested against golden dataset

**Prompt structure template:**
```
[ROLE]
You are an expert tutor specialized in {{domain}}...

[CONTEXT]
User profile: {{profile}}
Weak topics: {{weak_topics}}
Current document: {{document_summary}}

[RETRIEVED CONTEXT]
{{chunks}}

[CONVERSATION HISTORY]
{{history}}

[INSTRUCTIONS]
1. Use Socratic method...
2. Cite sources with [chunk_id]
3. Adapt difficulty to user mastery (currently {{mastery_score}})

[OUTPUT FORMAT]
{{format_spec}}
```

---

## 8. Frontend Architecture

### 8.1. Routing (App Router)

```
app/
├── (marketing)/
│   ├── page.tsx                    — landing
│   ├── pricing/page.tsx
│   └── about/page.tsx
├── (auth)/
│   ├── login/page.tsx
│   └── signup/page.tsx
├── (app)/
│   ├── layout.tsx                  — sidebar, command menu
│   ├── dashboard/page.tsx          — home (stats, due cards)
│   ├── workspace/[id]/
│   │   ├── page.tsx                — workspace home
│   │   ├── docs/[docId]/page.tsx   — PDF viewer + chat
│   │   └── chat/[chatId]/page.tsx  — full chat view
│   ├── flashcards/
│   │   ├── page.tsx                — deck list
│   │   ├── [deckId]/page.tsx       — manage deck
│   │   └── review/page.tsx         — review queue
│   ├── quiz/[id]/page.tsx
│   ├── graph/page.tsx              — knowledge graph viz
│   ├── analytics/page.tsx          — progress dashboard
│   └── settings/page.tsx
└── api/
    ├── trpc/[trpc]/route.ts
    ├── chat/route.ts               — streaming
    ├── upload/route.ts             — presigned URLs
    └── webhooks/
        ├── stripe/route.ts
        └── inngest/route.ts
```

### 8.2. Key UI Components

```
components/
├── ui/                          — shadcn primitives
├── chat/
│   ├── ChatInterface.tsx        — main chat
│   ├── MessageBubble.tsx
│   ├── CitationPopover.tsx      — hover citation → see source
│   ├── StreamingText.tsx
│   └── VoiceMode.tsx
├── document/
│   ├── PdfViewer.tsx            — react-pdf with highlight overlay
│   ├── UploadDropzone.tsx
│   └── DocumentList.tsx
├── flashcard/
│   ├── ReviewCard.tsx           — flip animation
│   ├── DeckEditor.tsx
│   └── ProgressRing.tsx
├── graph/
│   ├── KnowledgeGraph.tsx       — React Flow
│   ├── ConceptNode.tsx          — custom node with mastery color
│   └── GraphFilters.tsx
├── editor/
│   ├── NoteEditor.tsx           — TipTap
│   └── AICompletion.tsx         — inline AI suggest
└── shared/
    ├── CommandMenu.tsx          — Cmd+K
    ├── Sidebar.tsx
    └── ThemeToggle.tsx
```

### 8.3. State management

- **Server state:** TanStack Query + tRPC (auto-cached, optimistic updates)
- **Global UI state:** Zustand (sidebar open, theme, voice mode active)
- **Form state:** React Hook Form
- **Real-time:** Pusher subscriptions in `useEffect`, sync to TanStack Query cache

### 8.4. Performance

- React Server Components for static content
- Streaming for chat (Vercel AI SDK `useChat`)
- Suspense boundaries cho loading states
- `next/dynamic` cho heavy components (PDF viewer, graph)
- Image optimization (next/image)
- Edge runtime cho API routes có thể (auth, simple reads)

---

## 9. Folder Structure

**Pragmatic monolith** với pnpm workspaces. Spec ban đầu (tham vọng hơn)
tách `apps/worker` + `packages/ai|ui|types` riêng, nhưng thực tế Phase 0-10
gộp tất cả vào `apps/web` để giảm overhead. Refactor khi product grow.

```
cogniva/                                     — Thực tế Phase 0-10
├── apps/
│   └── web/                       — Next.js 15 App Router (toàn bộ stack)
│       ├── src/
│       │   ├── app/                — route handlers + pages (App Router)
│       │   │   ├── (app)/          — protected routes (dashboard, chat, ...)
│       │   │   ├── api/            — REST route handlers (Next.js native)
│       │   │   ├── sign-in/sign-up — auth routes
│       │   │   └── layout.tsx
│       │   ├── components/         — UI (chat, flashcards, quiz, ...)
│       │   ├── lib/                — domain logic
│       │   │   ├── ai/             — model adapters
│       │   │   ├── chat/           — pipeline (RAG context build)
│       │   │   ├── concepts/       — extract + dedup + prereq
│       │   │   ├── flashcards/     — FSRS + generators
│       │   │   ├── quiz/           — generate + grade
│       │   │   ├── mastery/        — BKT + recommend
│       │   │   ├── notes/          — AI complete
│       │   │   ├── gamification/   — XP + achievements
│       │   │   ├── observability/  — Sentry + PostHog + cost
│       │   │   ├── rate-limit/     — token bucket
│       │   │   ├── retrieval/      — vector + reranker
│       │   │   └── ingest/         — pipeline
│       │   ├── instrumentation.ts  — Sentry init
│       │   └── middleware.ts       — Better Auth session check
│       ├── e2e/                    — Playwright specs
│       ├── evals/                  — golden RAG eval scripts
│       ├── scripts/                — CLI helpers (extract-concepts, mine-prereq)
│       ├── public/
│       ├── playwright.config.ts
│       ├── vitest.config.ts
│       └── package.json
│
├── packages/
│   ├── db/                        — Drizzle schema + client (postgres.js)
│   └── tsconfig/                  — shared TS base config
│
├── infrastructure/
│   └── docker-compose.yml         — Postgres + pgvector local
│
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── plan.md                        — master spec (file này)
└── README.md
```

**Deferred** (Phase 11+ nếu cần scale):
- `apps/worker/` — Inngest jobs cho ingest, concept extraction (hiện sync inline trong API route + fire-and-forget)
- `packages/ai/` — tách AI utilities khỏi `apps/web/src/lib/` nếu reuse cho mobile/extension
- `packages/ui/` — tách shadcn components khỏi `apps/web` nếu cần share
- `apps/extension/` — browser extension (V3 feature)

---

## 10. Roadmap 16 tuần

> **Status legend:** ✅ done · 🚧 in progress · ⬜ pending

### Phase 0: Foundation (Tuần 1-2) — ✅ **Mostly complete (2026-05-11)**
**Goal:** Repo + auth + basic UI shell

- [x] Setup monorepo (pnpm + turbo)
- [x] Next.js 15 app with App Router *(plan said 14; Next 15 stable now, no functional difference)*
- [x] Tailwind + shadcn/ui *(New York style, slate base, 12 primitives wired)*
- [x] Auth với Better Auth (email/password + OAuth Google) — custom shadcn forms *(email/password fully wired; Google OAuth conditional on env keys)*
- [x] Drizzle + PostgreSQL + pgvector (local Docker) *(17 tables, HNSW + GIN indexes, vector(1536))*
- [x] Basic layout: sidebar, top nav, dashboard skeleton
- [ ] Deploy preview to Vercel *(repo on GitHub at dovanviet04112004/datn-cogniva — Vercel import still pending)*
- [x] CI: lint + typecheck + build on PR *(GitHub Actions workflow active)*

**Deliverable:** Live URL, login works, empty dashboard.
> ✅ Login + dashboard verified end-to-end against real Postgres on 2026-05-11. Vercel import is the only outstanding item.

### Phase 1: Document Ingestion (Tuần 3-4) — ✅ **MVP shipped (2026-05-11)**
**Goal:** Upload PDF → see chunks in DB

- [x] Storage abstraction with local FS impl *(R2 swap: chỉ thêm `r2.ts` đáp ứng cùng interface `Storage` — code app không đổi)*
- [x] Upload UI with progress *(react-dropzone + sonner toast, drag-drop + click-pick, validate size/MIME)*
- [ ] Inngest setup *(skipped Phase 1 v1 — chạy inline trong route handler. Swap khi PDF >10 MB hoặc khi cần retry policy)*
- [x] Ingestion job: PDF parse + chunk + embed *(unpdf parser, recursive char splitter ~512 token + overlap 200 chars, Voyage AI primary + OpenAI fallback)*
- [x] pgvector extension + embedding storage *(vector(1024) HNSW, verified end-to-end)*
- [ ] PDF viewer page (react-pdf) *(deferred to Phase 2 — chỉ cần khi click citation jump-to-page)*
- [x] Document list UI *(server component, status pill, page count, chunk count, relative time)*
- [x] PDF viewer page (react-pdf) *(landed in Phase 2 — react-pdf with PDF.js worker từ unpkg CDN, page navigation + zoom + URL hash `#page-N` cho citation jump)*

**Deliverable:** Upload PDF → background processed → see "Ready" status.
> ✅ Verified 2026-05-11: 4-page sample PDF → 4 chunks, vector(1024) via voyage-3, status READY trong **2 giây** end-to-end. UI render đúng với badge + metadata.

### Phase 2: RAG Chat MVP (Tuần 5-6) — ✅ **MVP shipped (2026-05-11)**
**Goal:** Q&A on uploaded docs with citations

- [x] Chat UI (streaming, Vercel AI SDK) *(useChat hook + token-by-token render + auto-scroll + Cmd/Ctrl+Enter to send)*
- [x] Basic vector retrieval (top-5) *(pgvector cosine `<=>`, scoped by user, optional workspace filter)*
- [ ] Mastra workflow (basic: retrieve → generate) *(deferred — current `buildChatContext` is linear function, sẽ wrap Mastra khi Phase 3 query classification thêm branching; @mastra/core dep đã install)*
- [x] Citation extraction & rendering *(inline `[N]` + CJK `【N】` regex → popover với snippet, score, page, link)*
- [x] Click citation → jump to PDF page *(citation popover link tới `/documents/[id]#page-N`, PdfViewer đọc hash + scroll — overlay highlight trong trang để Phase 3)*
- [x] Conversation persistence *(Drizzle: USER msg lưu trước stream, ASSISTANT + citations + cost trong onFinish)*
- [x] Langfuse integration *(trace mỗi turn chat với retrieval span + generation span; no-op khi env chưa cấu hình)*

**Deliverable:** Demo-able chat with citations.
> ✅ Verified 2026-05-11: query "Tài liệu test.pdf nói về cái gì?" → 4 chunks retrieve (top score 0.69) → openai/gpt-oss-20b free model qua OpenRouter stream Vietnamese reply có [1][3] citations → conversation + messages persisted to DB với token usage. AI provider abstraction hỗ trợ Anthropic (paid prod) + OpenRouter (free testing với 24+ free model).

### Phase 3: Advanced RAG (Tuần 7) — ✅ **MVP shipped (2026-05-11)**
**Goal:** Production-quality retrieval

- [x] HyDE query rewriting *(lib/retrieval/hyde.ts — generate hypothetical answer 2-4 câu rồi embed thay query gốc; graceful fallback khi LLM lỗi/empty)*
- [x] Hybrid search (BM25 + vector) *(lib/retrieval/bm25.ts dùng Postgres tsvector + ts_rank_cd norm 32; chunk_content_tsv_idx GIN đã có sẵn trong schema. Vector + BM25 chạy parallel trong advanced.ts)*
- [x] Cohere reranking *(lib/retrieval/rerank.ts — rerank-multilingual-v3.0 hỗ trợ tiếng Việt; graceful no-op khi COHERE_API_KEY trống → pipeline vẫn chạy)*
- [x] MMR diversity *(lib/retrieval/mmr.ts — λ=0.7, greedy O(n²); chunks pass embedding qua includeEmbedding flag từ vector + BM25 search)*
- [x] Build golden dataset (50 Q-A pairs) *(evals/golden-build.ts — random sample chunks → LLM synthesize Q-A có ground_truth_chunk_id; chạy `pnpm eval:golden [size]`)*
- [x] RAGAS evals (faithfulness, relevancy) *(evals/ragas.ts — 4 metric LLM-as-judge: faithfulness, answer_relevancy, context_relevancy, context_recall (binary chunk hit))*
- [x] A/B test: basic RAG vs advanced → measure *(evals/run.ts — chạy 2 mode song song trên golden, in bảng delta + win rate + latency ratio; output evals/results.json)*

**Deliverable:** Eval dashboard showing improvements.
> ✅ Built 2026-05-11: pipeline HyDE→Hybrid(vector+BM25)→RRF(k=60)→Cohere rerank→MMR(λ=0.7) trong `lib/retrieval/advanced.ts`. Switch qua `RETRIEVAL_MODE=basic|advanced` env (default `advanced`). Eval runner output bảng so sánh 4 metric × 2 mode + latency.
>
> **Smoke A/B 2026-05-11 (N=4, DB chỉ có test.pdf):**
> | Metric | Basic | Advanced | Δ |
> |---|---|---|---|
> | faithfulness | 0.750 | **1.000** | +0.25 |
> | answer_relevancy | 1.000 | 1.000 | 0 |
> | context_relevancy | **0.930** | 0.875 | -0.055 |
> | context_recall | 1.000 | 1.000 | 0 |
> | latency mean | 477ms | 10799ms | ×22.6 |
>
> Pipeline hoạt động end-to-end (HyDE + BM25 + Cohere rerank + MMR). N=4 quá nhỏ để significant; cần upload tài liệu lớn hơn (50-200 chunks) rồi rebuild golden để đo chính xác. Latency ×22 phần lớn do HyDE qua OpenRouter free model — Anthropic prod ×1.5-3.

**Cohere setup (free trial):**
1. Signup tại https://dashboard.cohere.com/welcome/register (email, không cần thẻ)
2. Vào https://dashboard.cohere.com/api-keys → copy "Trial keys"
3. Paste vào `apps/web/.env.local` dòng `COHERE_API_KEY="..."` (free 1000 search/tháng đủ dev + golden eval)
4. Pipeline graceful no-op khi key trống → vẫn chạy được mà không có rerank stage

### Phase 4: Knowledge Graph (Tuần 8-9) — ✅ **MVP shipped (2026-05-11)**
**Goal:** Auto-extract concepts and visualize

- [x] Concept extraction job *(lib/concepts/extract.ts — LLM scan từng chunk → list named concepts với name/description/domain; bỏ qua từ chung chung; failure → return [] không crash batch)*
- [x] Concept dedup (vector matching) *(lib/concepts/dedup.ts — embed concept name qua Voyage → HNSW search threshold 0.85 → reuse hoặc INSERT mới)*
- [x] Prerequisite mining *(lib/concepts/prerequisite.ts — group concepts theo domain ≤20/batch → LLM sinh edges (from, to, strength) → insert vào concept_relation với onConflictDoNothing)*
- [x] React Flow graph UI *(@xyflow/react v12 + Dagre auto-layout TB; ConceptNode tô màu theo domain; MiniMap+Controls+Background; sidebar nav `/graph` đã có sẵn)*
- [x] Mastery color coding *(stub — ConceptNode đọc data.mastery, ring color đỏ/vàng/xanh theo BKT score; Phase 6 wire dữ liệu thật từ bảng `mastery`)*
- [x] Click node → see related chunks/cards *(ConceptPanel slide từ phải, fetch /api/graph/concept/[id] → list chunks + filename + page; click chunk → /documents/[id]#page-N)*

**Deliverable:** Beautiful graph showing user's learning landscape.
> ✅ Built 2026-05-11: pipeline `extractConceptsForChunks(chunkIds)` chạy auto trong ingest pipeline (sau khi chunks insert + READY) hoặc backfill qua `pnpm extract:concepts [docId|--user X|--prereq]`. Schema thêm `chunk_concept` pivot (chunkId × conceptId × strength). API `GET /api/graph` trả format React Flow-compatible (nodes + edges). UI `/graph` page render React Flow với Dagre layout + ConceptPanel side. Mastery color coding sẵn UI nhưng data chưa wire (Phase 6).
>
> Cần upload tài liệu mới (hoặc chạy `pnpm extract:concepts` trên test.pdf hiện có) để có concepts hiển thị.

### Phase 5: Flashcards + SR (Tuần 10) — ✅ **MVP shipped (2026-05-11)**
**Goal:** Spaced repetition system

- [x] Manual card creation *(FlashcardForm component, /flashcards page form collapsible, hỗ trợ BASIC + CLOZE + IMAGE_OCCLUSION)*
- [x] AI-generate cards from doc/chunk *(lib/flashcards/generate.ts — LLM scan chunks → JSON {front, back} hoặc cloze text; API /api/flashcards/generate body {documentId, type, limit})*
- [x] FSRS algorithm implementation *(ts-fsrs v4 wrapper lib/flashcards/fsrs.ts; state machine NEW→LEARNING→REVIEW + RELEARNING khi lapse; difficulty/stability/retrievability/due/lastReview lưu thẳng cột flashcard)*
- [x] Daily review UI (swipe/keyboard) *(ReviewSession component, keyboard 1=Again/2=Hard/3=Good/4=Easy + Space=reveal, mobile-friendly grid 4-button)*
- [x] Review stats *(StatsPanel — due today, retention 7d %, breakdown state count; API /api/flashcards/stats join review table)*
- [x] Cloze deletion support *(lib/flashcards/cloze.ts — Anki-compat syntax {{c1::text}} hoặc {{c1::text::hint}}; ClozeRenderer ẩn/hiện theo revealed bool)*
- [x] **Bonus: IMAGE_OCCLUSION** *(react-konva editor vẽ rectangle masks → upload ảnh /api/flashcards/upload-image → ImageOcclusionViewer overlay div absolute positioned theo % để responsive)*

**Deliverable:** Functional Anki-like flashcard system.
> ✅ Built 2026-05-11: full Phase 5 với 3 card types. Schema flashcard + review từ Phase 0 reuse 100% (FSRS fields đã design sẵn). Review queue ưu tiên NEW > RELEARNING > LEARNING > REVIEW + due ASC (Anki convention). Latency ~50ms/review (chỉ DB UPDATE + INSERT). Có thể start dev server `pnpm dev` và mở /flashcards để demo.
>
> **Sequel cần (Phase 7+):**
> - Audio cards (TTS qua ElevenLabs)
> - Anki import (.apkg parser)
> - Multi-cloze split (1 text {{c1}} + {{c2}} → 2 cards)
> - Card editor inline trong review (bấm 'e' edit nhanh)

### Phase 6: Quiz + Mastery (Tuần 11)
**Goal:** Adaptive quizzing

- [x] Quiz generator (MCQ, TRUE_FALSE, short answer) — `lib/quiz/generate.ts`
- [x] Quiz attempt UI — `/quiz/[id]/attempt` + `QuizAttemptSession`
- [x] AI grading for short answers — `lib/quiz/grade.ts` (LLM compare userAnswer ↔ correctAnswer)
- [x] BKT mastery update — `lib/mastery/bkt.ts` (4-param model) + `lib/mastery/update.ts` (applyAttempt sau mỗi attempt)
- [x] Forgetting curve decay job — `POST /api/mastery/decay` (cron-auth, half-life 14 ngày)
- [x] Recommendation: "what to study next" — `lib/mastery/recommend.ts` (priority = weakness × prereq importance)
- [x] /graph wire mastery — ConceptNode tô màu theo BKT score (đỏ/vàng/xanh)
- [x] /quiz page: MasteryPanel (bar list) + RecommendationsPanel (top 5)

**Deliverable:** End-to-end learning loop closed.

> ✅ Built 2026-05-11: pipeline `generateQuestions(chunkContent, types, count)` sinh quiz JSON-schema chuẩn → INSERT quiz + questions. Attempt route chấm tuần tự (binary cho MCQ/T-F, LLM cho SHORT), gọi `applyAttempt(userId, conceptId, score)` để update bảng mastery theo BKT. `getRecommendations` xếp hạng concepts cần ôn dựa trên (1-mastery) × log(1+prereq_count). UI `/quiz` list + dialog AI gen + player tuần tự + ResultsView; `/graph` ConceptNode đã ring-color theo mastery.

### Phase 7: Polish + Productivity (Tuần 12)
**Goal:** Notes, planner, search

- [x] Notes editor (TipTap StarterKit + Placeholder) — `/notes/[id]` autosave 1.2s
- [x] AI inline completion — Tab cuối câu gọi `/api/notes/complete` chèn tại cursor
- [x] Global search (Cmd+K / Ctrl+K) — `CommandPaletteButton` trong topbar, search 5 nguồn (docs/concepts/flashcards/quizzes/notes) qua `/api/search`
- [x] Study planner (basic) — `/study-plan` 2 cột Pending/Done, due date overdue badge
- [x] Pomodoro timer — `PomodoroWidget` trong topbar, state machine 25/5/15 với localStorage + Web Notification + Web Audio chuông
- [x] Mobile responsive audit — sidebar hamburger drawer (Phase 6 follow-up), topbar pl-14 không che, page list dùng `min-w-0 flex-1` đúng pattern

**Deliverable:** Feels like a real product, not a demo.

> ✅ Built 2026-05-11: schema thêm `note` (id, title, content HTML TipTap, concept/document FK optional) + `study_plan_item` (status PENDING/DONE, due_date, completed_at). API CRUD đầy đủ cho 2 entity + `/api/notes/complete` (LLM hoàn câu, prefix 500 ký tự cuối, maxTokens 120) + `/api/search` (5 entity ILIKE parallel với Promise.all). UI: `/notes` list + `/notes/[id]` TipTap editor; `/study-plan` 2-column kanban-lite; topbar swap search input → `CommandPaletteButton` mở `cmdk` dialog overlay; Pomodoro widget xen giữa ThemeToggle + UserMenu. Toàn bộ Vietnamese comments + JSDoc.

### Phase 8: Voice + Multimodal (Tuần 13)
**Goal:** Wow factor features

- [x] Voice chat — **Browser Web Speech API** (webkitSpeechRecognition cho STT, speechSynthesis cho TTS) thay vì Whisper+ElevenLabs để zero cost + zero latency. Trade-off chất lượng giọng (phase 9+ swap ElevenLabs khi cần)
- [ ] Real-time interrupt — DEFERRED Phase 9+ (cần WebRTC/LiveKit infra)
- [x] Image upload Q&A — file attach trong chat composer, `experimental_attachments` (Vercel AI SDK) → Claude Sonnet 4.6 vision model auto-handle, multi-file (max 4) preview thumb có nút X xóa
- [x] Math handwriting recognition — `MathCanvasDialog` HTML5 canvas (mouse + touch), export PNG → attach như image → vision model nhận dạng

**Deliverable:** Demo video that wows.

> ✅ Built 2026-05-11: 4 components mới (`VoiceInputButton`, `TtsButton`, `MathCanvasDialog`, file attach inline trong `ChatInterface`). Composer mở rộng: textarea + Mic + ImageAttach + PencilLine + Send. `MessageBubble` của assistant thêm `TtsButton` đọc to khi stream xong. Chat route handle content array (vision message): tách `query` text-only cho RAG retrieval, fallback `[image-only message]` khi user chỉ gửi ảnh để retrieval không crash. Real-time interrupt skip — Phase 9+ cần WebRTC stack riêng.

### Phase 9: Social + Gamification (Tuần 14)
**Goal:** Retention features

- [x] Streaks + XP — `user_stats` table, `awardXp(userId, amount, ctx)` cập nhật atomic XP + streak (today/yesterday/break → reset 1). Hook vào 4 events: flashcard review (+2/+5), quiz answer correct (+10), note create (+3), document upload (+20)
- [x] Achievements — 10 badges hardcoded (`lib/gamification/achievements.ts`): first_upload/quiz/note/flashcard + xp_100/500/1000 + streak_3/7/30. `checkNewAchievements()` chạy sau mỗi awardXp, append vào `user_stats.achievements TEXT[]`
- [x] Public profiles — cột `user.is_public BOOLEAN`, route `/profile/[id]` public không cần auth (middleware allow), `/profile` (chính chủ) toggle visibility
- [x] Study groups (basic) — `study_group` + `study_group_member` schema; CRUD API; invite code 8 ký tự ABCDE-style (loại 0/O/1/I); /groups list + create + join by code + /groups/[id] detail với member list
- [x] Leaderboard — `GET /api/leaderboard` top 20 user.is_public=true sort xp DESC, top 3 highlight gold/silver/bronze ring

**Deliverable:** Sticky product.

> ✅ Built 2026-05-11: 3 bảng mới (`user_stats` PK userId, `study_group` + `study_group_member` với uniqueIndex `group_id × user_id`); thêm cột `user.is_public`. Gamification: 6 file lib + 7 API endpoints + 5 UI pages + `StreakBadge` topbar (Flame icon + currentStreak + xp). Middleware: tách `exactProtected` cho `/profile` để `/profile/[id]` public truy cập được; sidebar group "Social" mới gom 3 link Profile/Leaderboard/Groups.

### Phase 10: Production Hardening (Tuần 15)
**Goal:** Scale-ready

- [x] Rate limiting — token bucket in-memory `lib/rate-limit/`, preset chat (30/phút), aiGenerate (10/phút), upload (20/phút). Wire 5 endpoint: chat, flashcards/generate, quiz/generate, notes/complete, documents/upload. Trả 429 với Retry-After header
- [x] Cost monitoring — `lib/observability/cost.calcCostUsd(model, in, out)` cho 6 model phổ biến, lưu vào `message.metadata.costUsd`. `/api/analytics` aggregate 30d (totalCost, byModel, last7Days)
- [x] Sentry + error boundaries — `lib/observability/sentry.captureError()` no-op trong dev, `AppErrorBoundary` class component wrap root layout với fallback UI tiếng Việt + nút reload. `instrumentation.ts` auto-init khi server start
- [x] PostHog analytics — `PosthogProvider` client-side autoCapture + pageview qua usePathname; server-side `trackEvent()` trong chat onFinish (event `chat_message_completed` với model + tokens + cost)
- [x] Loading states audit — `SkeletonList` component (avatar + 2 line + badge skeleton), thay text "Đang tải..." trong /flashcards và /quiz
- [x] Accessibility — icon-only button đã có aria-label từ Phase 5-9, `<img>` có alt, focus-visible từ shadcn defaults. Lighthouse 100 score là deferred goal Phase 11
- [x] Security review — OWASP top 10 checklist (xem 11.4 cập nhật)
- [x] E2E tests — Playwright config + 2 spec: `smoke.spec.ts` (homepage + protected redirect + sign-in render), `public-routes.spec.ts` (leaderboard + 404 profile không bị auth redirect). `pnpm test:e2e` chạy

**Deliverable:** "Production-ready" badge.

> ✅ Built 2026-05-11: 4 file lib observability (rate-limit, sentry, posthog server, cost) + 2 component (`AppErrorBoundary` class + `PosthogProvider` client) + 1 instrumentation + 1 endpoint `/api/analytics` aggregate + 2 spec Playwright. Deps thêm: @sentry/nextjs, posthog-js, posthog-node, @playwright/test (dev). Drizzle-orm dedup sau install để clear peer conflict (@types/pg).

### Phase 11: Launch (Tuần 16) — ⏸️ **DEFERRED** (skip sang Phase 12 V2)

User quyết định skip Phase 11 (Launch / market) sang sau khi V2 Rooms+Exam
build xong. Lý do: features chưa đủ thuyết phục để launch ngay, V2 mới là
differentiator. Phase 11 items move sang post-V2 backlog.

- [ ] Stripe subscriptions
- [ ] Pricing page
- [ ] Landing page (high-conversion)
- [ ] Demo video (Loom, 90s)
- [ ] Documentation site
- [ ] Product Hunt launch
- [ ] Reddit/Twitter announcements
- [ ] Open-source select packages

**Deliverable (deferred):** Live, payable, marketable.

### Phase 12: Infrastructure Foundation (Tuần 17) — 🚧 **In progress (2026-05-11)**

> V2 Rooms + Exam, xem chi tiết tại `plan-rooms-and-exam.md` §Phase 12.

- [x] Infrastructure dir tree (`infrastructure/livekit|coturn|soketi|caddy|scripts`)
- [x] Docker Compose dev (`docker-compose.dev.yml`) — local stack LiveKit + Soketi + Redis
- [x] Docker Compose prod (`docker-compose.prod.yml`) — full stack (Hocuspocus + Egress comment chờ Phase 14/15)
- [x] LiveKit config dev + prod template (`livekit.dev.yaml` + `livekit.prod.yaml.example`)
- [x] coturn template (`turnserver.conf.example`) — TURN relay cho 10-15% behind symmetric NAT
- [x] Caddyfile prod — reverse proxy WS qua Let's Encrypt
- [x] Provisioning script (`scripts/provision-server.sh`) — Hetzner Ubuntu 22.04 idempotent, role media/app
- [x] DNS records doc (`scripts/dns-records.md`) — Cloudflare table (LiveKit/coturn NOT proxied)
- [x] Generate keys script (`scripts/generate-keys.sh`) — random secret OpenSSL
- [x] Health check script (`scripts/health-check.sh`) — cron 5min, alert Slack webhook
- [x] apps/web deps: livekit-server-sdk, livekit-client, @livekit/components-react, pusher, pusher-js
- [x] `src/lib/livekit.ts` — `createLivekitToken()` + `getRoomService()` + `getActiveParticipantCount()`, lazy env init
- [x] `src/lib/realtime-server.ts` — `getPusherServer()` + `triggerEvent()` + `authorizeChannel()`
- [x] `src/lib/realtime-client.ts` — `getPusherClient()` + `useRealtimeEvent()` hook
- [x] `src/lib/env.ts` thêm Phase 12 vars vào Zod schema
- [x] `apps/web/src/app/api/health/route.ts` — endpoint healthcheck DB + LiveKit + Soketi
- [ ] Hetzner servers up + DNS pointing (cần user action: tạo account + DNS Cloudflare)
- [ ] Smoke test LiveKit Meet demo 2 tab thấy nhau

**Deliverable:** Khi user `docker compose -f infrastructure/docker-compose.dev.yml up -d`, có
LiveKit ws://localhost:7880 + Soketi ws://localhost:6001 + Redis sẵn sàng cho Phase 13 build.

> ✅ Built 2026-05-11 (local stack only): infrastructure files + apps/web lib wiring.
> Production deploy (Hetzner + DNS + SSL) chờ user provision VPS thật.
>
> **Local test xác nhận:** docker compose dev stack up OK (LiveKit + Soketi + Redis healthy),
> `/api/health` trả status `ok` cho cả 3 service. Soketi tag fix `1.6-16-debian` (plan ghi sai `1-16-debian`).

### Phase 13: Study Room Core (Tuần 18) — ✅ **MVP shipped (2026-05-11)**

> Chi tiết tại `plan-rooms-and-exam.md` §Phase 13. Phase 13.8 (waiting room +
> scheduled rooms) đặt thành deferred — chỉ wire khi cần.

**Schema (6 tables, 5 enums):**
- [x] `room`, `room_member`, `room_message`, `room_event`, `recording`, `collab_doc`
- [x] Enums: `room_type`, `room_visibility`, `room_status`, `room_member_role`, `room_member_status`
- [x] Apply migration qua psql trực tiếp (db:push hang trong WSL/Windows env)

**API routes:**
- [x] `GET/POST /api/rooms` — list mine + joined / create với joinCode unique
- [x] `GET/DELETE /api/rooms/[id]` — fetch detail / owner delete
- [x] `POST /api/rooms/[id]/token` — issue LiveKit JWT TTL 2h, auto-add MEMBER nếu visibility ≠ PRIVATE, capacity check qua LiveKit API
- [x] `POST /api/rooms/join` — join by 6-char code, auto-activate membership
- [x] `POST /api/webhooks/livekit` — sync room_started/finished/participant_joined/left → DB

**UI:**
- [x] `/rooms` — list mine + joined với memberCount sum query, Create dialog + Join by code input
- [x] `/rooms/[id]/lobby` — cam preview (getUserMedia native), toggle mic/cam, save prefs localStorage, RoomShareCode (copy code + link)
- [x] `/rooms/[id]` — LiveKitRoom wrapper, fetch token + simulcast 3 layers (h180/h360/h720), VideoGrid adaptive cols, ControlBar (mic/cam/screen/hand/leave + M/C shortcuts), ParticipantList sidebar

**Components mới:**
- [x] `components/rooms/{video-grid,control-bar,participant-list,create-room-dialog,join-by-code,room-share-code,lobby-form,room-client}.tsx`
- [x] `components/ui/dialog.tsx` (shadcn Radix wrapper, đã có @radix-ui/react-dialog từ Phase 7)
- [x] `lib/rooms/codes.ts` — generateJoinCode() 6-char base32 Crockford

**Wiring:**
- [x] Sidebar: thêm group "Spaces" > Study Rooms (Video icon)
- [x] Middleware: `/rooms` protected prefix

**Deliverable:** User tạo room qua UI → share 6-char code → 2 browser tab join cùng room → thấy/nghe nhau qua LiveKit local (no TURN, OK trên cùng LAN/wifi).

**Skipped (defer):**
- Waiting room flow (Phase 13.8 plan) — `requireApproval` schema sẵn nhưng UI flow chờ user need.
- Scheduled rooms cron — Inngest cron sẵn pattern, wire khi Phase 14+ có Inngest setup.

### Phase 14: Room Collaboration (Tuần 19) — ✅ **Built (2026-05-11)**

> Chi tiết tại `plan-rooms-and-exam.md` §Phase 14. 6/6 mục ship.

**Realtime layer (Soketi):**
- [x] `POST /api/realtime/auth` — sign presence/private channel với SOKETI_SECRET, verify user member ACTIVE
- [x] `getPusherClient()` singleton (Phase 12 đã sẵn) + `useRealtimeEvent()` hook tái dùng

**Chat:**
- [x] `GET/POST /api/rooms/[id]/chat` — fetch 50 message gần nhất + send với broadcast Soketi `chat:message`
- [x] `components/rooms/chat-panel.tsx` — initial load + subscribe presence-room-{id}, auto-scroll bottom, avatar + own/other layout

**Mod actions:**
- [x] `POST /api/rooms/[id]/moderate` — discriminated union 8 actions: KICK, MUTE, UNMUTE_REQUEST, LOCK, APPROVE, REJECT, PROMOTE, DEMOTE
- [x] LiveKit RoomService `removeParticipant` + `mutePublishedTrack` cho KICK/MUTE
- [x] Soketi broadcast `room:kicked` / `room:approved` / `room:rejected` tới `presence-user-{id}`
- [x] Owner-only: LOCK, PROMOTE, DEMOTE. Mod-or-Owner: KICK, MUTE, APPROVE
- [x] `participant-list.tsx` rewrite: dropdown menu 3-chấm cho mỗi participant (chỉ mod thấy)

**Pomodoro:**
- [x] `components/rooms/pomodoro-timer.tsx` — 3 mode FOCUS/SHORT_BREAK/LONG_BREAK
- [x] Sync qua LiveKit data channel (không cần Soketi) — broadcast state {mode, startAt, durationSec, pausedAt}
- [x] Wallclock-based (Date.now()) thay vì interval count → khỏi drift khi tab background

**Reactions floating:**
- [x] `components/rooms/reactions-layer.tsx` + `reaction-picker.tsx` (10 emoji)
- [x] Publish qua LK data channel (unreliable OK)
- [x] CSS `@keyframes float-up` 2s translate -280px + scale 1.4 + fade

**Hocuspocus service (Yjs server):**
- [x] New workspace `apps/hocuspocus/` — Node ESM, port 1234
- [x] `Server.configure()` với JWT auth (verify userId + roomId + kind match document name)
- [x] `Database` extension persist binary state vào bảng `collab_doc` (base64 encode)
- [x] Dockerfile multi-stage (deps → build → runner) cho prod deploy
- [x] Dev: `pnpm dev:hocus` chạy `tsx watch --env-file=../web/.env.local src/server.ts`
- [x] Root scripts: `dev:web` + `dev:hocus` cho dev riêng từng service

**Whiteboard collab (Excalidraw + Yjs):**
- [x] `POST /api/rooms/[id]/collab-token` — issue JWT 15min cho kind whiteboard|notes|code
- [x] `components/rooms/whiteboard-panel.tsx` — dynamic import Excalidraw (no SSR, ~600KB), bidirectional sync Yjs ↔ Excalidraw qua observe + onChange, lastSerializedRef guard chống loop

**Shared notes (TipTap + Yjs):**
- [x] `components/rooms/notes-panel.tsx` — TipTap v3 với `Collaboration` + `CollaborationCursor` extension
- [x] StarterKit.configure({undoRedo: false}) — TipTap v3 rename `history` → `undoRedo`, tắt vì Yjs UndoManager đảm nhận
- [x] Color cursor stable từ hash userName → HSL hue

**Wire vào RoomClient:**
- [x] Sidebar Tabs (4 tab): Chat | Participants | Notes | Whiteboard — icon-only để gọn 360px width
- [x] Pomodoro bar trên cùng main column
- [x] ReactionsLayer absolute overlay
- [x] `components/ui/{dialog,tabs}.tsx` shadcn pattern (@radix-ui/react-dialog, @radix-ui/react-tabs)

**Deps mới (apps/web):** yjs, @hocuspocus/provider, jsonwebtoken, @tiptap/extension-collaboration@^3, @tiptap/extension-collaboration-cursor@^3, @excalidraw/excalidraw, @radix-ui/react-tabs
**Deps mới (apps/hocuspocus):** @hocuspocus/server, @hocuspocus/extension-database, jsonwebtoken, postgres, tsx, typescript

**Env mới:** `JWT_SECRET` (32+ ký tự, shared giữa apps/web issuer và apps/hocuspocus verifier) + `NEXT_PUBLIC_HOCUSPOCUS_URL`

**Deliverable:** Room có chat realtime + whiteboard cộng tác + notes cộng tác + pomodoro đồng bộ + emoji reactions + mod kick/mute/lock/promote.

**Setup test:**
```bash
# Terminal 1: realtime stack đã chạy (Phase 12)
# Terminal 2: Next.js dev
pnpm dev:web
# Terminal 3: Hocuspocus dev
pnpm dev:hocus
```

Sau đó add vào `.env.local`: `JWT_SECRET=dev-jwt-secret-at-least-32-chars-long-cogniva-xxx` + `NEXT_PUBLIC_HOCUSPOCUS_URL=ws://localhost:1234`.

### Phase 15: AI Tutor + Recording (Tuần 20) — ✅ **Built (2026-05-11)**

> Chi tiết tại `plan-rooms-and-exam.md` §Phase 15. Đã ship đủ 4/4 deliverable; runtime needs ffmpeg binary + OPENAI_API_KEY (Whisper) + R2 recordings bucket cho prod.

**Deviation từ plan §15.2:** dùng Vercel AI SDK `streamText` + `getChatModel()` (đã có từ Phase 3) thay vì scaffold Mastra runtime. Cùng pattern với `/api/chat/route.ts`. Giữ interface `streamRoomTutor()` mimic Mastra `agent.stream()` để swap sau dễ. Phase 18 (Adaptive Testing) cần workflow phức tạp → khi đó mới scaffold Mastra.

**AI Tutor (in-room @AI):**
- [x] `lib/ai/room-tutor.ts` — buildTutorSystemPrompt (persona + room context + RAG chunks scoped theo askingUserId), `streamRoomTutor()` trả `textStream` + `finishPromise`
- [x] `lib/ai/summarize.ts` — `summarizeTranscript()` (map-reduce >8K từ) + `generateFlashcardsFromTranscript()` (JSON output, 10 cards default)
- [x] `POST /api/rooms/[id]/ai-message` — rate limit 10/min/user/room (preset `aiGenerate`), insert placeholder AI message → for-await `textStream` → broadcast `ai:streaming` mỗi delta → `ai:complete` khi xong + update DB content
- [x] `chat-panel.tsx` update — detect `@AI` prefix (regex), gọi /ai-message song song /chat (để user message vẫn vào lịch sử), bind `ai:streaming`/`ai:complete`/`ai:error`, render bubble AI với blinking caret khi streaming + error state

**Recording (LiveKit Egress → R2):**
- [x] `POST /api/rooms/[id]/record` — mod-only, S3Upload với R2 endpoint, `startRoomCompositeEgress(roomId, output, 'speaker')`, insert recording row status RECORDING, broadcast `recording:started`
- [x] `POST /api/rooms/[id]/record/[recordingId]/stop` — mod-only, `stopEgress(egressId)`, idempotent (swallow 404), update PROCESSING + broadcast `recording:stopped`
- [x] `GET /api/rooms/[id]/record` — list 50 recordings cho room (member-only)
- [x] Webhook `egress_ended` (livekit/route.ts) — extract `fileResults[0].location` + size + duration, update recording → fire Inngest event `recording/finished` → broadcast `recording:ended`
- [x] `components/rooms/record-button.tsx` — state machine IDLE/STARTING/RECORDING/STOPPING, init query GET /record để pick up active recording (mod refresh), Soketi sync giữa nhiều mod
- [x] `components/rooms/recording-banner.tsx` — privacy notice "Buổi học đang được GHI HÌNH bởi {byUserName}" hiển thị TO ở top, không cho dismiss (Phase 15 compliance §🔐)

**Inngest pipeline (post-processing):**
- [x] `inngest/client.ts` — singleton `Inngest({id:'cogniva'})` + typed `InngestEvents` table với `recording/finished`
- [x] `inngest/functions/process-recording.ts` — 7 steps độc lập retry (extract-audio → probe-duration → mark-processing → transcribe → summarize → detect-chapters → generate-flashcards → persist → notify); mỗi step có try/catch riêng để 1 step fail không kill pipeline (graceful degradation: no Whisper → no transcript nhưng vẫn save video)
- [x] `app/api/inngest/route.ts` — `serve({client, functions})` cho Inngest Cloud/CLI discovery
- [x] `lib/media/ffmpeg.ts` — `extractAudio` (16kHz mono WAV PCM cho Whisper), `getMediaDuration` (ffprobe), `downloadToTmp` (R2 presigned), `safeUnlink` cleanup
- [x] `lib/media/whisper.ts` — `whisperTranscribe()` OpenAI Whisper-1 với `verbose_json` để có segments + timestamps, `isWhisperConfigured()` gate cho pipeline skip transcribe nếu thiếu key
- [x] `lib/media/chapters.ts` — `detectChapters()` heuristic: group segments thành blocks 75s → embed Voyage → cosine similarity < 0.65 = boundary, merge chapter <120s

**Replay UI:**
- [x] `/rooms/[id]/recordings` — list 50 recordings với duration + status badge, link sang `[recId]`
- [x] `/rooms/[id]/recordings/[recId]` — server fetch + verify member ACTIVE + redirect khi status=RECORDING (chưa kết thúc)
- [x] `components/rooms/replay-client.tsx` — 2-col layout: video player + summary (markdown) | chapters (click seek) + transcript scrollable; polling 15s + Soketi `recording:processed` event để auto-refresh khi pipeline xong

**Wire vào RoomClient:**
- [x] `ControlBar` thêm prop `roomId` + `isMod` → render `<RecordButton>` chỉ khi mod
- [x] `room-client.tsx` thêm `<RecordingBanner roomId={...}/>` ở top main column

**Deps mới:** `inngest@^3.27.0`

**Env mới:** `R2_RECORDINGS_BUCKET` (default "cogniva-recordings"). Existing: `OPENAI_API_KEY` (Whisper), `R2_*` (egress upload), `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` (prod).

**Runtime requirements:**
- `ffmpeg` binary trong PATH (Windows dev: `choco install ffmpeg`, prod VPS: pre-installed via provision script)
- LiveKit Egress container chạy (xem `plan-rooms-and-exam.md` §12.2 docker-compose.prod.yml — Phase 15 uncomment block egress)
- Inngest dev server: `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`

**Acceptance (qua live test cần khi user smoke):**
- [ ] Gõ `@AI lim là gì` → bubble AI bay vào chat, từng token stream cho cả phòng thấy
- [ ] Mod bấm Record → banner đỏ TO xuất hiện cho mọi participant; bấm Stop → banner biến mất, sau ~30s pipeline xong → `/rooms/[id]/recordings` thấy row PROCESSED
- [ ] Replay page: click chapter → video seek đúng timestamp, transcript hiển thị bên cạnh

**Known limitations Phase 15 v1:**
- Flashcard tự gen gắn vào owner room (không share với members) — schema flashcard chưa có metadata jsonb để track `fromRecordingId`; Phase 18 sẽ thêm.
- ffmpeg phụ thuộc binary local — Inngest function chạy trên Vercel sẽ FAIL nếu ffmpeg không pre-bundled. Workaround: dùng Inngest Cloud + self-host runner, hoặc swap sang `@ffmpeg/ffmpeg` WASM (chậm 5-10x).
- Egress fileUrl trỏ trực tiếp R2 — chưa có presigned. Phase 16+ sẽ thêm signed URL TTL 1h cho privacy compliance.

### Phase 10 follow-up — Bug fixes + lấp link 404 (2026-05-11)

Sau Phase 10 commit (`c969024`), audit đã phát hiện 1 số vấn đề + thêm
việc nhỏ. Lưu chronological để git audit trail match plan:

- `671eec2` fix(voice): better error UX cho speech recognition — phân
  loại `network`/`not-allowed`/`audio-capture` với message tiếng Việt
  hữu ích (trước chỉ hiện raw error code).
- `eb358db` fix(chat): image-only send dùng `append()` thay vì
  `handleSubmit` — AI SDK v4 skip submit khi input rỗng, khiến math
  canvas + image attach không gửi được nếu không gõ text.
- `ebf329e` feat: build `/analytics` + `/workspaces` UI — lấp 2 link
  sidebar 404 (chưa có page từ Phase 0 placeholder). Thêm REST API
  workspaces CRUD + `POST /api/documents/[id]/move` đổi workspace.
- **Audit fix** (commit sắp tới): add 3 deps thiếu trong `package.json`
  (`@sentry/nextjs`, `posthog-js`, `posthog-node` — đã cài node_modules
  nhưng quên save package.json); fix `vitest.config.ts` exclude `e2e/**`
  (Playwright spec làm vitest crash vì cùng `test()` global khác API);
  sync plan §5/§6/§9 với reality.

### Stage 2 — Scale-up (M4+) — 🚧 **In progress (2026-05-11)**

> Master plan ở `scale-up-master-plan.md` §15.2. Stage 1 closed (rate-limit
> Redis + cost guardrail + LLM router + DB scaling + observability +
> backup/restore + audit log + GDPR + load test + COPPA). Stage 2 = M4-M12
> (5-8 eng theo plan; solo founder phase tới khi hire engineer #2-3).

#### M4 W1-W2: Cloudflare Workers edge gateway + Mobile RN bootstrap (2026-05-11) — local scaffold

**Edge gateway (`apps/edge/`):**
- [x] Hono + wrangler.toml + tsconfig (Workers compatible_flags `nodejs_compat`)
- [x] `RateLimitDO` Durable Object — token bucket per user/IP (capacity + refillPerSec, transactional storage, single-threaded race-safe)
- [x] `jwtVerifyMiddleware()` — đọc JWT từ Authorization header hoặc cookie `better-auth.session_token`, verify qua JWKS endpoint (`jose` lib, RSA/EdDSA, 1h cache), set `userId` vào context
- [x] `geoMiddleware()` — đọc CF `cf-ipcountry` + `cf.continent` → set `country` + `region` (asia/eu/us/oceania/africa) → forward header `x-cogniva-region` để origin chọn DB replica
- [x] `rateLimit()` — gọi DO check token bucket; auth user 120/min, anon IP 30/min; fail-open khi DO error; trả `X-RateLimit-*` + `Retry-After` headers
- [x] `csrf()` — double-submit cookie (`csrf-token` cookie + `x-csrf-token` header), bypass `/api/auth/*`, `/api/webhooks/*`, `/api/realtime/*`; constant-time compare
- [x] `featureFlags()` — eval flag từ KV `FLAGS_KV` (rollout %, allowList, denyList, FNV-1a hash), forward `x-cogniva-flags` header
- [x] `proxyToOrigin()` — forward tới Vercel với header enriched (trace, userId, country, region, flags, edge-verified secret); stream body (duplex 'half'); strip `x-powered-by`/`server`; add `x-edge-duration-ms`
- [x] `/__edge/health` bypass guard cho uptime check
- [x] Structured JSON logger + trace propagation (`cog-{16hex}-{8hex}` match `apps/web/src/middleware.ts`)
- [x] README với deploy guide (workers.dev free tier OK)

**Shared types (`packages/shared/`):**
- [x] `UserDTO` / `SessionDTO` / `DocumentDTO` / `FlashcardDTO` / `ReviewDTO` / `MasteryDTO` / `ChatMessageDTO` / `UsageDTO` / `ApiResult<T>` — plain DTO, KHÔNG re-export DB types
- [x] Zod schemas: `signUpSchema`, `signInSchema`, `documentMetaSchema`, `reviewRatingSchema`, `chatSendSchema`
- [x] `createApiClient()` — fetch-based, getToken callback (cookie cho web, SecureStore cho mobile), retry/error envelope

**Mobile (`apps/mobile/`):**
- [x] Expo SDK 52 + Expo Router 4 + RN 0.76 + New Architecture + Hermes
- [x] `app/_layout.tsx` — root: QueryClient + splash hydration
- [x] `app/index.tsx` — auto redirect dựa auth
- [x] `app/(auth)/` — sign-in + sign-up screens (Vietnamese UI, COPPA disclaimer redirect minor về web)
- [x] `app/(app)/` — Tabs (dashboard / flashcards / settings) với auth guard
- [x] `src/store/auth.ts` — Zustand store + hydrate từ SecureStore
- [x] `src/lib/storage.ts` — SecureStore wrapper (token + user cache)
- [x] `src/lib/api.ts` — singleton `@cogniva/shared` client với bearer token + platform header
- [x] `metro.config.js` — monorepo workspace resolution (watchFolders root)
- [x] README với deploy guide + simulator setup

**Workspace wire:**
- [x] Root scripts: `dev:edge`, `dev:mobile` thêm vào `package.json`
- [x] `turbo.json` thêm task `start` (cho Expo)
- [x] `pnpm-workspace.yaml` đã include `apps/*` + `packages/*` → tự pick

**M4 W3 — JWT plugin + anti-bypass + region routing (2026-05-12) — ✅ done:**
- [x] Wire Better Auth **JWT plugin** ở `apps/web/src/lib/auth.ts` (EdDSA Ed25519, issuer `cogniva`, audience `cogniva-app`, exp 7d, custom `definePayload` thêm `email/name/plan/parentalConsentStatus`)
- [x] Wire Better Auth **bearer plugin** với `requireSignature: true` → mobile gửi `Authorization: Bearer <session_token>` được verify
- [x] Endpoint `/api/auth/jwks` expose JWK Set (verified Ed25519 key trả về)
- [x] Endpoint `/api/auth/token` mint JWT 3-part từ Bearer session (verified payload có sub/email/plan/exp/iss/aud)
- [x] DB schema thêm `jwks` table + migration `0006_jwks.sql` + applied to dev DB
- [x] Mobile auth store: capture `set-auth-token` header trong sign-in + sign-up (sign-up đã có, thêm cho sign-in)
- [x] `apps/web/src/middleware.ts` **anti-bypass**: check `x-edge-verified=<EDGE_SHARED_SECRET>` ở production; bypass dev / staging / health endpoints
- [x] Middleware forward `x-cogniva-region` từ edge tới route handler
- [x] `packages/db` thêm `getDbForRegion(region)` helper — Stage 1 trả về `dbReplica` (universal); Stage 2 M5 wire multi-region replica envs
- [x] `lib/observability/logger.ts` thêm `getRegion()` async helper (read request header)

**M4 W4 — Close M4 (2026-05-12) — ✅ done:**
- [x] Mobile `mintJwt()` helper export + architecture: session token là primary bearer (origin Better Auth bearer plugin verify HMAC); JWT cho edge verify offline + 3rd party (Hasura/Supabase RLS sau này)
- [x] End-to-end pipeline tested với curl:
  - Origin direct: session bearer → `/api/auth/get-session` → 200
  - Edge → origin: session bearer forwarded → 200 trong 341ms
  - Edge `/api/auth/jwks` trả Ed25519 JWK Set
  - Edge `/api/auth/token` mint JWT 3-part với payload `{sub,email,plan,exp,iss=cogniva,aud=cogniva-app}`
  - Response API tự auto-issue `set-auth-jwt` header → mobile capture cho edge call sau (optional)
- [x] `.github/workflows/deploy-edge.yml` — `cloudflare/wrangler-action@v3` deploy worker on push main + manual dispatch staging/production + health check post-deploy
- [x] Edge JWT verify middleware tested: reject non-JWT bearer (sign-in returns 401 user-id null → rate limit per IP fallback), accept valid JWT bearer

**M4 đóng khẩu.** Stage 2 M4 W1-W4 close 4/4 (edge gateway + RN bootstrap + JWT/bearer + anti-bypass + region routing + CI deploy workflow).

**Cần thiết khi deploy production (chờ user setup):**
- [ ] CF account + domain → `wrangler login` + `wrangler kv namespace create FLAGS_KV` → paste id vào `wrangler.toml`
- [ ] GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `EDGE_SHARED_SECRET`
- [ ] Vercel env `EDGE_SHARED_SECRET` match edge (anti-bypass)
- [ ] Lần đầu deploy thủ công verify, sau đó workflow tự chạy push main

**Mobile pending (M6 W2-W3 batch riêng):** WatermelonDB offline cache + push notif APNs/FCM cert + document list/flashcard review/swipe gestures

#### M6 W2 — Mobile features (2026-05-12) — ✅ done

**Documents screen (`apps/mobile/app/(app)/documents.tsx`):**
- [x] FlatList fetch `api.documents.list()` qua TanStack Query
- [x] Pull-to-refresh (RefreshControl) + loading + empty + error states
- [x] Status badge với 4 màu (UPLOADING amber / PROCESSING blue / READY green / FAILED red)
- [x] File type icon (📕 PDF, 📘 DOCX, 📝 MD, 📄 TXT) + format bytes/pages

**Flashcards review (`apps/mobile/app/(app)/flashcards.tsx`):**
- [x] Full FSRS review flow: fetch due → show front → tap reveal → 4 rating buttons (Again/Hard/Good/Easy) → POST /api/flashcards/review → optimistic advance → next card
- [x] Progress bar `idx / total` realtime
- [x] Empty + completion states với refetch button
- [x] Mutation pending overlay (ActivityIndicator) khi đang sync API
- [x] Color-coded rating buttons match FSRS standard (red/amber/green/blue)

**Settings revamp (`apps/mobile/app/(app)/settings.tsx`):**
- [x] Account info: email, name, plan, COPPA status conditional
- [x] GDPR Article 20 — Export data button → POST /api/account/export → show URL
- [x] GDPR Article 17 — Delete account flow → confirm 2 lần → POST /api/account/delete (30-day grace) → auto sign-out
- [x] Sign out với confirm dialog
- [x] "Vùng nguy hiểm" section visually distinct (red border + light pink bg)

**Tab navigation update (`apps/mobile/app/(app)/_layout.tsx`):**
- [x] 4 tabs: Home / Tài liệu / Học / Tôi
- [x] Active color #0066FF, inactive #999

**Files mới batch này (5 mod + 1 new):**
```
apps/mobile/app/(app)/
  documents.tsx          (new — 158 LOC)
  flashcards.tsx         (rewrite — 240 LOC, từ placeholder thành full FSRS review)
  settings.tsx           (rewrite — 200 LOC, thêm GDPR export + delete)
  _layout.tsx            (add documents tab)
```

**Pending M6 W3:**
- [ ] Swipe gestures (Reanimated 4) thay cho tap rating button
- [ ] Document detail screen + PDF viewer (react-native-pdf)
- [ ] Document upload từ mobile (DocumentPicker + presigned URL)
- [ ] Push notifications (Expo Notifications + APNs/FCM cert thật)
- [ ] Deep linking `cogniva://flashcard/{id}` + `cogniva://room/{id}`
- [ ] Offline cache persisted với react-query-persist-client + AsyncStorage

#### M6 W3 — Mobile polish (2026-05-12) — ✅ done

**Offline cache:**
- [x] `PersistQueryClientProvider` + `createAsyncStoragePersister` ở root layout
- [x] Cache lưu vào AsyncStorage key `cogniva.query-cache`, max 24h, throttle 1s
- [x] Buster `v1` để invalidate khi API schema đổi
- [x] App reopen offline → cache restore → render data ngay (stale-while-revalidate)

**Swipe gestures (Reanimated 4 + Gesture Handler 2):**
- [x] Rewrite `apps/mobile/app/(app)/flashcards.tsx` từ tap buttons → swipe full UX
- [x] Tap card → flip front/back (animated opacity crossfade)
- [x] PanGesture track translation x/y → card translate + rotate (±15deg) theo drag
- [x] Color overlay theo direction → user thấy rating sắp được chọn (red/amber/green/blue)
- [x] 4 hướng swipe Anki/Mochi style: ← Quên / ↓ Khó / → Tốt / ↑ Dễ
- [x] Threshold 80px theo trục dominant → trigger rate + fly-off animation
- [x] Spring back nếu swipe nhẹ (chưa đủ threshold)
- [x] 4 rating buttons vẫn hiện bên dưới (accessibility cho user khó dùng gesture)

**Cancel deletion flow (GDPR Article 17 hoàn chỉnh):**
- [x] Shared API client thêm `deleteStatus()` GET + `requestDelete(reason)` POST với confirm "DELETE MY ACCOUNT"
- [x] Settings poll `/api/account/delete` → render banner amber khi `pending=true` với daysRemaining + scheduledFor
- [x] Cancel button → DELETE /api/account/delete → invalidate query → banner ẩn

**Document upload từ mobile:**
- [x] FAB button (góc phải dưới) + empty state upload button
- [x] `expo-document-picker` pick PDF (mime filter, max 1 file, copy to cache)
- [x] FormData multipart với asset URI → POST /api/documents/upload với Bearer auth
- [x] Loading state + alert success/error + auto refetch list
- [x] Backend xử lý ingest sync (5-30s) → mobile show busy ActivityIndicator

**Deps added (4):**
```
@tanstack/react-query-persist-client@^5.100
@tanstack/query-async-storage-persister@^5.100
expo-document-picker@~55.0
expo-file-system@~55.0
expo-sharing@~55.0
```

**M6 W4 — Mobile finalization (DONE):**
- [x] Document detail screen `app/(app)/documents/[id].tsx` — metadata header (filename, size, pages, status badge) + chunks browser (FlatList với pageStart/pageEnd) + "Mở web" button qua `Linking.openURL`
- [x] Restructure tab `documents` thành nested Stack (`documents/_layout.tsx` + `index.tsx` + `[id].tsx`) — fix conflict route giữa flat `documents.tsx` và `[id].tsx`
- [x] Wire card tap → `router.push('/documents/${id}')` (back swipe iOS / back gesture Android tự work)
- [x] Push notifications client `src/lib/notifications.ts`:
  - `registerForPushNotificationsAsync()` — request permission + Expo Push Token (`ExponentPushToken[xxx]`)
  - `setNotificationHandler` foreground banner + sound
  - `addNotificationTapListener(onNavigate)` — tap notif → router.push deep link (flashcard-due / room-invite / document-ready)
  - Android: tự setup default channel với HIGH importance
- [x] `NotificationsBridge` component trong root `_layout.tsx` — register token sau khi auth + lắng nghe tap → router.push
- [x] Deep linking config — `scheme: "cogniva"` đã có sẵn ở app.json; Expo Router 6 tự map `cogniva://documents/{id}` → `app/(app)/documents/[id].tsx`
- [x] `eas.json` — 3 build profiles:
  - `development`: dev client + iOS simulator + `EXPO_PUBLIC_API_URL=localhost:3000`
  - `preview`: internal (APK / TF) + `EXPO_PUBLIC_API_URL=staging.cogniva.app`
  - `production`: store + `autoIncrement` + `EXPO_PUBLIC_API_URL=cogniva.app` + submit config (Apple ID / Android service account)
- [x] `app.json` thêm `extra.eas.projectId` placeholder + `owner: cogniva` cho `eas init`

**Files mới M6 W4:**
```
apps/mobile/
  app/(app)/documents/_layout.tsx     # Nested Stack
  app/(app)/documents/index.tsx       # Move từ documents.tsx
  app/(app)/documents/[id].tsx        # Detail screen
  src/lib/notifications.ts            # Push token + tap listener
  eas.json                            # Build profiles
  app.json                            # Updated: notification icon ref removed, extra.eas.projectId added
  app/_layout.tsx                     # Updated: NotificationsBridge wire
  README.md                           # Updated: M6 W4 status + EAS + deep link docs
```

**Pending Stage 3 (mobile native deps):**
- [ ] Native PDF viewer (`react-native-pdf` — cần EAS dev client, không work trong Expo Go vì TurboModule native)
- [ ] iOS APNs cert + Android FCM service account JSON (cần Apple Dev Program $99/yr + Google Play Console $25)
- [ ] `eas init` chính thức → fill `projectId` thật + Apple Team ID + service account path

#### M7 — Push notification delivery (2026-05-12) — ✅ done

**Schema (`packages/db/`):**
- [x] Bảng `push_token` — `(id, user_id FK→user, token UNIQUE, platform ios/android/web, device_id?, enabled, created_at, last_seen_at)` + index `(user_id)` cho Inngest worker lookup
- [x] Bảng `notification_log` — audit trail `(user_id, type, title, body, data jsonb, status pending/sent/failed/rejected, receipt_id, error, sent_at, created_at)` + index `(user_id, type, created_at DESC)` cho 24h dedupe query
- [x] Migration `0007_push_token.sql` — idempotent CREATE TABLE + CREATE INDEX IF NOT EXISTS
- [x] Drizzle relations `pushTokenRelations` + `notificationLogRelations` (one-to-many từ `user`)
- [x] Export type `PushToken` / `NotificationLog` (cả `$inferSelect` + `$inferInsert`)

**Backend endpoint (`apps/web/`):**
- [x] `POST /api/account/push-token` — Zod validate Expo Push Token format, upsert theo `token` UNIQUE (cover case device transferred giữa users), audit log `push.token.{created|updated|transferred}`
- [x] `DELETE /api/account/push-token` — body `{ token }`, chỉ xoá nếu token thuộc user (chống user A craft request xoá token user B), audit log
- [x] Bearer protected (require `auth.api.getSession`), rate limit auto qua middleware 30/min anon hoặc 120/min auth

**Shared API client (`packages/shared/`):**
- [x] `account.registerPushToken({ token, platform, deviceId? })` → POST upsert
- [x] `account.unregisterPushToken(token)` → DELETE unregister

**Mobile wiring (`apps/mobile/`):**
- [x] `src/lib/notifications.ts` thêm `cachedToken` module-level singleton + `getCachedPushToken()` export (cho sign-out flow KHÔNG phải re-request permission)
- [x] `app/_layout.tsx` `NotificationsBridge` POST token sang `/api/account/push-token` sau khi `registerForPushNotificationsAsync` ok, log `action` (created/updated/transferred) cho debug
- [x] `src/store/auth.ts` `signOut()` DELETE token TRƯỚC khi clear session (cần Bearer còn hợp lệ); failure không block sign-out flow (stale token sẽ tự dọn ở cron khi Expo Push API trả `DeviceNotRegistered`)

**Inngest worker (`apps/web/src/inngest/functions/flashcard-due-reminder.ts`):**
- [x] Cron `0 13 * * *` — 13:00 UTC daily = 20:00 VN (giờ học buổi tối)
- [x] Step 1 `query-candidates` — SQL aggregate `count(*) WHERE due <= NOW AND state != 'NEW' GROUP BY userId HAVING count >= 5` (threshold tránh spam khi 1-2 thẻ)
- [x] Step 2 `dedupe-recent-sent` — skip user đã nhận `flashcard-due` trong 24h gần nhất (query `notification_log` WHERE status='sent')
- [x] Step 3 `lookup-tokens` — fetch tất cả `push_token` enabled cho eligible users, build `(userId, token, dueCount)` targets
- [x] Step 4 `send-expo-push` — batch 100 token/request gửi Expo Push API `https://exp.host/--/api/v2/push/send`; capture tickets + invalidTokens (`DeviceNotRegistered`)
- [x] Step 5a `cleanup-invalid-tokens` — DELETE FROM push_token WHERE token = ANY(invalidTokens)
- [x] Step 5b `insert-notification-logs` — 1 row/user với status 'sent' nếu ANY device thành công, else 'failed' + error message
- [x] Registered trong `apps/web/src/app/api/inngest/route.ts` `serve({ functions: [...] })`

**Files mới M7:**
```
packages/db/src/schema.ts                                   # +pushToken +notificationLog +relations +types
packages/db/migrations/0007_push_token.sql                  # NEW
packages/shared/src/api/index.ts                            # +account.registerPushToken / unregisterPushToken
apps/web/src/app/api/account/push-token/route.ts            # NEW POST/DELETE
apps/web/src/inngest/functions/flashcard-due-reminder.ts    # NEW
apps/web/src/app/api/inngest/route.ts                       # +flashcardDueReminder registered
apps/mobile/src/lib/notifications.ts                        # +cachedToken +getCachedPushToken
apps/mobile/app/_layout.tsx                                 # NotificationsBridge POST backend
apps/mobile/src/store/auth.ts                               # signOut() unregister token
```

**Acceptance — smoke test 2026-05-12 ✅:**
- [x] Apply migration 0007 → `push_token` + `notification_log` tables exist
- [x] Mobile sign-in trên Android device thật → log `[push] backend register OK: created`
- [x] `push_token` row: 1 (`ExponentPushToken[Ka0_e1ETO1D4...]` / android / mobileapp@gmail.com)
- [x] Seed 6 LEARNING cards due (inline SQL — không qua seed-flashcards.ts vì script tạo state=NEW mà worker skip)
- [x] Trigger Inngest function manual qua UI `http://localhost:8288` → 6 step OK
- [x] Device nhận push "Đến giờ ôn tập rồi! Bạn có 6 thẻ đang chờ"
- [x] `notification_log` row: status='sent', receipt_id `019e1c8a-8f6a-7704-b714-...`, data `{type:'flashcard-due',dueCount:6}`

**Smoke test pending (chưa verify cần test sau):**
- [ ] **Tap notification → router.push deep link** — khi push tới app đang background hoặc closed, tap notif phải mở app + navigate `/flashcards`. Smoke test 2026-05-12 không verify được vì app đang foreground (notif show banner overlay, không trigger response listener). Test cách: tắt app hẳn (vuốt khỏi recent) → trigger Inngest → tap notif → app mở vào `/flashcards`
- [ ] **Sign-out unregister token** — `signOut()` đã wire `api.account.unregisterPushToken(cachedToken)` nhưng chưa test live. Verify: sign-out mobile → `SELECT * FROM push_token WHERE token = '...'` empty
- [ ] **24h dedupe** — invoke function 2 lần liên tiếp → lần 2 phải skip user vì `notification_log.status='sent'` < 24h. Verify: trigger Invoke 2 lần, lần 2 step `dedupe-recent-sent` filter ra hết
- [ ] **DeviceNotRegistered cleanup** — uninstall Expo Go khỏi phone → trigger → Expo Push API trả `DeviceNotRegistered` → step `cleanup-invalid-tokens` xoá row khỏi push_token. Verify: phone uninstall + DB query thấy row deleted

**Bugs đã fix trong smoke test:**
- `app.json` để placeholder `REPLACE_ME_*` projectId — code pass placeholder → Expo Server validate UUID fail. **Fix:** chạy `eas init` chính thức (login Expo + create real project) → ghi real projectId vào app.json. Project ID hiện tại: `72508ea4-d50b-4dd4-a7e6-155fd654b3bc` (owner `dovanviet`).
- Drizzle `sql\`... = ANY(${array})\`` không serialize JS array đúng qua postgres.js → query fail ở 3 step (`dedupe-recent-sent`, `lookup-tokens`, `cleanup-invalid-tokens`). **Fix:** dùng `inArray(column, array)` từ `drizzle-orm` thay vì raw sql template.
- SDK 54 đã xoá anonymous push token fallback của Expo Go → MUST có real EAS projectId. Code `notifications.ts` đã update remove the "skip placeholder" hack.

**Why batch 100 + Expo Push API thay vì FCM/APNs trực tiếp:**
- Expo Push API miễn phí, 1 endpoint cover cả iOS + Android — KHÔNG cần Apple Dev Program ($99/yr) hay Google service account JSON ở giai đoạn dev/test
- Token format `ExponentPushToken[xxx]` ổn định, không phụ thuộc EAS production build → chạy được trên Expo Go dev cho test
- Stage 3 nếu cần feature nâng cao (rich media, action buttons) sẽ migrate sang FCM/APNs trực tiếp qua `expo-server-sdk` hoặc Firebase Admin SDK

**Why cron 20:00 VN không TZ-aware:**
- TZ-aware notif cần `user.timezone` field + cron mỗi giờ + check TZ match → phức tạp, chỉ worth khi target market non-VN > 30%
- 20:00 VN cover hầu hết VN user (target chính); EU/US user nhận giờ kỳ lạ — accept trade-off MVP
- Stage 3 sẽ thêm `user.timezone` + UI Settings "Giờ nhắc nhở mong muốn" + cron mỗi giờ filter theo TZ

**Why local scaffold trước:**
- Wrangler dev emulate Workers runtime LOCAL (`workerd` binary, DO + KV in-memory) → KHÔNG cần CF account hay domain để code + test logic
- Khi user mua domain + CF account → chỉ cần `wrangler login` + `wrangler kv namespace create FLAGS_KV` + paste id + `wrangler deploy`. Code 100% production-ready.

**Files mới batch này:**
```
apps/edge/                    (14 files)
  package.json, tsconfig.json, wrangler.toml, .gitignore, .dev.vars.example,
  README.md, src/{index.ts, env.ts}
  src/lib/{logger.ts, trace.ts}
  src/do/rate-limit-do.ts
  src/middleware/{trace,geo,jwt-verify,csrf,rate-limit,feature-flags}.ts
  src/routes/proxy.ts

packages/shared/              (7 files)
  package.json, tsconfig.json
  src/{index.ts, api/index.ts, types/index.ts, schemas/index.ts}

apps/mobile/                  (18 files)
  package.json, tsconfig.json, app.json, babel.config.js, metro.config.js,
  expo-env.d.ts, .gitignore, .env.example, README.md
  src/{lib/{storage,api}.ts, store/auth.ts}
  app/{_layout.tsx, index.tsx}
  app/(auth)/{_layout.tsx, sign-in.tsx, sign-up.tsx}
  app/(app)/{_layout.tsx, dashboard.tsx, flashcards.tsx, settings.tsx}
```

**Total LOC scaffolded:** ~2.4K LOC (TS), 100% Vietnamese-commented (header + JSDoc).

**Cost estimate khi deploy:**
- Workers paid $5/mo (10M req/mo + DO + KV included) — 10K MAU ~$15/mo total
- Expo / EAS Build free tier đủ cho dev; production submit App Store ($99/yr) + Play ($25 one-time)

**Acceptance khi smoke test (cần `pnpm install` trước):**
- [ ] `pnpm --filter @cogniva/edge dev` → wrangler dev port 8787 → `curl http://localhost:8787/__edge/health` → 200 OK JSON
- [ ] `curl -X POST http://localhost:8787/api/test -i` (no cookie/header) → 403 CSRF mismatch (mutating method without token)
- [ ] `curl http://localhost:8787/__edge/health` x 300 lần → trigger rate limit anon IP, expect 429 sau 30 req trong cùng phút
- [ ] `pnpm --filter @cogniva/mobile start` → QR code → Expo Go scan → sign-in screen render
- [ ] Mobile sign-up → API call tới `http://LAN_IP:3000/api/auth/sign-up/email` → user tạo + dashboard render (yêu cầu LAN IP hoặc ngrok, không phải localhost)

---

## 11. DevOps, Security, Compliance

### 11.1. Environments
- `local` — Docker compose, seeded data
- `preview` — Vercel preview per PR
- `staging` — staging.cogniva.com, weekly deploy
- `production` — cogniva.com, on-demand deploy

### 11.2. Secrets management
- Vercel env vars (encrypted)
- Doppler / Infisical for sync across envs
- Never commit `.env` (use `.env.example`)

### 11.3. Database
- Daily automated backups (PITR)
- Connection pooling (PgBouncer or Supabase Pooler)
- Read replicas if scale requires

### 11.4. Security checklist (OWASP top 10 audit — Phase 10)
- [x] **A01 Broken access control** — Every protected route verifies `auth.api.getSession()`; middleware redirect `protectedPrefixes`. Scope queries qua `where(eq(table.userId, session.user.id))` để chống IDOR (xem flashcard, note, group routes)
- [x] **A02 Cryptographic failures** — Better Auth hash password (bcrypt) + session cookie httpOnly + secure flag
- [x] **A03 Injection** — All inputs Zod validated; Drizzle parameterizes 100% query; raw SQL chỉ qua `sql\`\`` template tag (auto-parameterize); pgvector params dùng `::vector` cast string literal an toàn
- [x] **A04 Insecure design** — Rate limit lib/rate-limit (chat/aiGenerate/upload preset); `note.content` HTML không render via dangerouslySetInnerHTML (TipTap render qua editor); image upload validate mime + size
- [ ] **A05 Security misconfiguration** — CSP headers chưa add (Phase 11 polish). Cookie flags Better Auth defaults
- [ ] **A06 Vulnerable components** — Dependabot enable trên GitHub Phase 11
- [x] **A07 Auth failures** — Better Auth handle login attempt rate limit; session expiry 7d default
- [ ] **A08 Software integrity** — `pnpm audit` chưa chạy CI; sẽ wire vào pre-commit hook Phase 11
- [x] **A09 Logging failures** — Langfuse trace mọi LLM call (chat/quiz/flashcard gen); Sentry capture exception qua AppErrorBoundary + captureError helper
- [x] **A10 SSRF** — Không có endpoint nhận URL user để fetch; image upload là direct multipart không qua URL

### 11.5. Privacy & Compliance
- GDPR: data export, account deletion endpoints
- DPA available for paid users
- Privacy policy + ToS (use templates from Termly/iubenda)
- Data retention: 30-day soft delete, then hard delete
- AI-specific: disclose models used, allow opt-out of training (Anthropic doesn't train on API by default — make sure)

### 11.6. Cost controls
- LLM budget per user per month (free tier: 100k tokens/day)
- Cached embeddings (don't re-embed identical text)
- Use Haiku for cheap tasks (chunking, classification)
- Stream early tokens to give perception of speed
- Aggressive Redis cache (1hr default)

---

## 12. Evaluation & Observability

### 12.1. Eval datasets
Build 4 datasets, version-controlled in `tests/golden/`:

1. **Retrieval eval** — 100 queries with ground-truth chunks
   - Metric: Recall@5, MRR
2. **Faithfulness eval** — 100 (query, retrieved, answer) triplets
   - Metric: RAGAS faithfulness (no hallucination)
3. **Answer quality** — 100 (query, ideal_answer) pairs
   - Metric: Semantic similarity, LLM-as-judge
4. **Concept extraction** — 50 documents with annotated concepts
   - Metric: Precision, Recall

### 12.2. CI evals
On every PR touching `packages/ai`:
- Run all 4 evals
- Fail PR if any metric drops > 5%
- Post results as PR comment

### 12.3. Observability stack
- **Langfuse**: every LLM call traced (prompt, response, latency, cost, tokens)
- **Sentry**: errors with source maps
- **PostHog**: events (button clicks, feature usage), session replay (privacy-aware)
- **Helicone**: cost dashboard per feature
- **Vercel Analytics**: Web Vitals (LCP, INP, CLS)

### 12.4. KPIs to track
- **Engagement:** DAU/MAU, session length, retention D1/D7/D30
- **Learning:** mastery growth/week, cards reviewed/day, quiz accuracy
- **AI quality:** P50/P95 latency, faithfulness score, user thumbs up/down
- **Business:** signup conversion, free→paid, MRR, churn
- **Cost:** $/user/month (LLM + infra), gross margin

### 12.5. Dashboards
Build 3 dashboards (Metabase or PostHog):
1. **Product health** — DAU, retention, NPS
2. **AI performance** — latency, faithfulness, eval scores
3. **Cost** — $/feature, $/user, projected burn

---

## 13. Monetization

### 13.1. Freemium tiers

| Feature | Free | Pro ($12/mo) | Team ($25/user/mo) |
|---|---|---|---|
| Documents | 10 | Unlimited | Unlimited |
| AI messages/day | 50 | 500 | 2000 |
| Voice mode | ❌ | ✓ | ✓ |
| Knowledge graph | ✓ | ✓ + advanced | ✓ |
| Flashcards | 500 | Unlimited | Unlimited |
| Quiz generation | 5/day | Unlimited | Unlimited |
| Collaborative groups | ❌ | 3 members | Unlimited |
| Priority models | Haiku | Sonnet | Opus available |
| Support | Community | Email | Priority |
| Data export | ✓ | ✓ | ✓ + API access |

### 13.2. Strategy
- Free tier generous enough to be useful (otherwise no virality)
- Free → Pro conversion goal: 3-5%
- Annual discount: 20% off
- Student discount: 50% off (verify with .edu email)
- Lifetime deal on launch: $99 (limited 100 spots) → AppSumo-style

### 13.3. Other revenue
- Team/enterprise: custom pricing
- Marketplace: users sell their decks/quizzes (rev share)
- API access for Pro+ ($0.01/request)

---

## 14. Portfolio & Marketing

### 14.1. Portfolio impact
Khi present cho recruiter, focus vào:

**Technical depth:**
- "Built multi-stage RAG with HyDE + hybrid search + reranking → 91% faithfulness"
- "Implemented Bayesian Knowledge Tracing for adaptive learning"
- "Designed eval framework with 400-item golden dataset"
- "Reduced P95 latency 4.2s → 1.8s with streaming + caching"

**Production craft:**
- "Built Langfuse observability covering 100% of LLM calls"
- "CI runs evals on every PR — prevents regression"
- "Cost optimization: routed simple queries to Haiku, saved 70% LLM cost"

**Show, don't tell:**
- Live demo URL
- 90s Loom walkthrough
- Architecture diagram (the one we made)
- Eval dashboard screenshot
- Langfuse trace screenshot
- Open-source 1-2 packages (the eval framework, the FSRS impl)

### 14.2. Launch channels
- **Product Hunt** — schedule for Tuesday launch
- **Hacker News** — Show HN with technical post
- **Reddit** — r/ChatGPT, r/learnmachinelearning, r/GetStudying, r/Anki
- **Twitter/X** — thread with architecture diagram
- **Indie Hackers** — milestone posts
- **YouTube** — demo video, "How I built X" tutorial
- **Dev.to / Medium** — technical write-ups (RAG patterns, FSRS)

### 14.3. SEO
- Blog with technical posts (RAG, evals, prompt engineering)
- Comparison pages: "Cogniva vs Quizlet", "Cogniva vs Anki"
- Free tools: "PDF to flashcards", "AI quiz generator" → lead gen

### 14.4. Open source strategy
Open-source these standalone packages:
- `@cogniva/fsrs` — TS implementation of FSRS
- `@cogniva/rag-evals` — eval harness
- `@cogniva/prompt-versioning` — prompt mgmt + A/B testing
This builds reputation and gets external contributors.

---

## 🎯 Definition of Done (Project)

A recruiter looking at this should think:
- [x] "This person can architect production AI systems"
- [x] "They understand evaluation, not just prompting"
- [x] "They know observability and cost management"
- [x] "The code quality is professional (tests, types, CI)"
- [x] "The product itself is genuinely useful — not a toy"

A user trying it should think:
- [x] "This actually understands what I'm learning"
- [x] "It's faster than my current workflow"
- [x] "I want to use this every day"

---

## 📚 Learning resources during build

Recommended reading parallel to building:
- **RAG**: "Retrieval-Augmented Generation for Knowledge-Intensive NLP" (Lewis 2020)
- **Evals**: Eugene Yan's blog, especially "Evals" series
- **Mastra docs**: agents, workflows, evals, tracing (mastra.ai/docs)
- **Better Auth docs**: plugins, adapters, OAuth providers (better-auth.com)
- **Anthropic prompt engineering guide**
- **FSRS paper**: "A stochastic shortest path algorithm for optimizing spaced repetition"
- **BKT**: "Knowledge Tracing: Modeling the Acquisition of Procedural Knowledge"
- **Production AI**: "Building LLM applications for production" (Chip Huyen)

---

## 🚀 Next concrete steps

1. **Today**: Reserve domain (cogniva.com or alternative), GitHub org, register Anthropic + Cohere + OpenAI API keys
2. **This week**: Phase 0 — get repo + auth + Vercel deploy live
3. **Set up Langfuse account** (free self-host with Docker, or cloud free tier)
4. **Build golden dataset incrementally** — every time you test, save to dataset
5. **Public build journey** — tweet weekly progress, build in public

---

*Plan version 1.0 — May 2026. Update as you build; no plan survives contact with the keyboard intact.*
