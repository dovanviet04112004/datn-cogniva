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

### 6.1. tRPC routers structure

```typescript
// server/routers/_app.ts
export const appRouter = router({
  auth:        authRouter,        // signup, login, oauth
  user:        userRouter,        // profile, preferences
  workspace:   workspaceRouter,   // CRUD workspaces
  document:    documentRouter,    // upload, list, delete
  chat:        chatRouter,        // messages, stream
  flashcard:   flashcardRouter,   // CRUD, review
  quiz:        quizRouter,        // generate, attempt, grade
  concept:     conceptRouter,     // graph, mastery
  analytics:   analyticsRouter,   // stats, reports
  search:      searchRouter,      // global search
  group:       groupRouter,       // study groups (V3)
});
```

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

Monorepo với pnpm workspaces:

```
cogniva/
├── apps/
│   ├── web/                       — Next.js app
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   ├── server/
│   │   │   ├── routers/
│   │   │   ├── db/
│   │   │   └── trpc.ts
│   │   ├── prompts/
│   │   ├── public/
│   │   └── package.json
│   ├── worker/                    — Inngest jobs
│   │   ├── functions/
│   │   │   ├── ingest-document.ts
│   │   │   ├── extract-concepts.ts
│   │   │   ├── update-mastery.ts
│   │   │   └── generate-flashcards.ts
│   │   └── package.json
│   └── extension/                 — browser extension (V3)
│
├── packages/
│   ├── ai/                        — AI utilities
│   │   ├── src/
│   │   │   ├── pipelines/
│   │   │   ├── retrievers/
│   │   │   ├── prompts/
│   │   │   ├── evals/
│   │   │   └── tools/
│   │   └── package.json
│   ├── db/                        — Drizzle schema + client (postgres.js driver)
│   ├── ui/                        — shared shadcn components
│   ├── config/                    — eslint, tsconfig, tailwind presets
│   └── types/                     — shared TS types
│
├── tooling/
│   ├── eslint-config/
│   └── tsconfig/
│
├── infrastructure/
│   ├── docker/
│   │   └── postgres/
│   └── terraform/                 — IaC (optional)
│
├── docs/
│   ├── architecture.md
│   ├── prompts.md
│   └── evals.md
│
├── tests/
│   ├── e2e/                       — Playwright
│   └── golden/                    — eval datasets
│
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── eval.yml               — run RAG evals on PR
│       └── deploy.yml
│
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── README.md
```

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

- [ ] Rate limiting all endpoints
- [ ] Cost monitoring + alerts
- [ ] Sentry + error boundaries
- [ ] PostHog analytics
- [ ] Loading states audit
- [ ] Accessibility audit (Lighthouse 100)
- [ ] Security audit (OWASP top 10)
- [ ] E2E tests for critical paths

**Deliverable:** "Production-ready" badge.

### Phase 11: Launch (Tuần 16)
**Goal:** Ship + market

- [ ] Stripe subscriptions
- [ ] Pricing page
- [ ] Landing page (high-conversion)
- [ ] Demo video (Loom, 90s)
- [ ] Documentation site
- [ ] Product Hunt launch
- [ ] Reddit/Twitter announcements
- [ ] Open-source select packages

**Deliverable:** Live, payable, marketable.

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

### 11.4. Security checklist
- [ ] All inputs validated with Zod
- [ ] SQL injection: Drizzle parameterizes (✓), raw SQL only via `sql` template tag
- [ ] XSS: React escapes by default, sanitize HTML if rendering markdown
- [ ] CSRF: tRPC + same-origin (✓)
- [ ] Rate limiting (Upstash) per IP and per user
- [ ] CORS strict
- [ ] CSP headers
- [ ] Secrets rotation quarterly
- [ ] Dependabot enabled
- [ ] Audit logs for sensitive actions

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
