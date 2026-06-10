/**
 * Schema cơ sở dữ liệu của Cogniva — định nghĩa bằng Drizzle ORM.
 *
 * Cấu trúc theo nhóm:
 *   1. Custom column (vector cho pgvector)
 *   2. Enums (plan, doc_status, role, fsrs_state, …)
 *   3. Bảng do Better Auth quản lý (user, session, account, verification)
 *   4. Bảng domain Cogniva: workspace, document, chunk, concept, mastery,
 *      conversation, message, flashcard, review, quiz, question, study_session
 *   5. Quan hệ (relations) cho phép join type-safe qua drizzle-orm
 *   6. Kiểu dòng đã suy luận (User, Workspace, …) cho app code
 *
 * Lưu ý:
 *   - User row do Better Auth tạo (id, email, emailVerified, name, image,
 *     created_at, updated_at). Cogniva mở rộng thêm `plan` + `preferences`.
 *   - Cột `embedding` dùng vector(1024) — tương thích với:
 *       voyage-3 (Anthropic recommend, 1024 dim native, free 200M token)
 *       voyage-3-large (chất lượng cao nhất, 1024 dim)
 *       voyage-3-lite (cho embedding tốc độ cao, 512 dim — cần migrate xuống nếu dùng)
 *     1024 < 2000 nên fit HNSW. Khi đổi sang OpenAI 1536 hoặc 3072 phải
 *     migrate dim này (xem docs/plans/master.md §3.3).
 *   - HNSW index tạo qua sql template tag vì Drizzle hiện chưa có API cao
 *     cấp cho operator class `vector_cosine_ops`.
 */
import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

import type {
  ChunkMetadata,
  Citation,
  DocumentMetadata,
  MessageMetadata,
  QuizConfig,
  UserPreferences,
} from './types';

// ──────────────────────────────────────────────────────────
// Custom column: vector(N) của pgvector
// ──────────────────────────────────────────────────────────
/**
 * Tạo cột vector(N) tương thích pgvector cho Drizzle.
 *
 * Cách lưu: Postgres nhận chuỗi dạng "[0.12, -0.04, ...]" — toDriver chuyển
 * mảng số → chuỗi trước khi gửi. fromDriver chuyển ngược lại khi select.
 *
 * @param name - Tên cột trong DB
 * @param dim  - Số chiều vector (3072 = text-embedding-3-large)
 */
const vector = (name: string, dim: number) =>
  customType<{ data: number[]; driverData: string; config: { dim: number } }>({
    dataType() {
      return `vector(${dim})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: unknown): number[] {
      if (Array.isArray(value)) return value as number[];
      return JSON.parse(String(value));
    },
  })(name);

// ──────────────────────────────────────────────────────────
// Enums — dùng pgEnum để Postgres tự kiểm tra giá trị
// ──────────────────────────────────────────────────────────
/** Gói cước người dùng: FREE (mặc định), PRO ($12/tháng), TEAM ($25/user/tháng). */
export const planEnum = pgEnum('plan', ['FREE', 'PRO', 'TEAM']);

/**
 * Parental consent status — COPPA (Children's Online Privacy Protection Act).
 *
 * Plan v2 §3.7.2 + §15.1 W9-10.
 *
 * Flow:
 *   - NOT_REQUIRED: user ≥ 13 tuổi (hoặc DOB chưa nhập — Stage 1 legacy user).
 *     Account full functional.
 *   - PENDING: user < 13, đã nhập parent email, đang đợi parent verify.
 *     Account LIMITED — gate AI, upload, room, chat.
 *   - VERIFIED: parent đã click link + confirm. Account full functional.
 *   - REJECTED: parent click link nhưng từ chối. Account vĩnh viễn limited
 *     (admin có thể delete sau 30 ngày).
 */
export const parentalConsentStatusEnum = pgEnum('parental_consent_status', [
  'NOT_REQUIRED',
  'PENDING',
  'VERIFIED',
  'REJECTED',
]);

/** Trạng thái xử lý của tài liệu sau upload. UPLOADING → PROCESSING → READY/FAILED. */
export const docStatusEnum = pgEnum('doc_status', [
  'UPLOADING',
  'PROCESSING',
  'READY',
  'FAILED',
]);

/** Vai trò trong cuộc hội thoại — USER = người dùng gõ, SYSTEM = prompt mồi. */
export const messageRoleEnum = pgEnum('message_role', ['USER', 'ASSISTANT', 'SYSTEM']);

/** Loại flashcard — BASIC mặt trước/sau, CLOZE che 1 phần, IMAGE_OCCLUSION che ảnh. */
export const cardTypeEnum = pgEnum('card_type', ['BASIC', 'CLOZE', 'IMAGE_OCCLUSION']);

/** Trạng thái thẻ trong vòng đời FSRS. */
export const fsrsStateEnum = pgEnum('fsrs_state', [
  'NEW',
  'LEARNING',
  'REVIEW',
  'RELEARNING',
]);

/** Loại câu hỏi quiz. */
export const questionTypeEnum = pgEnum('question_type', [
  'MCQ',
  'TRUE_FALSE',
  'SHORT',
  'ESSAY',
  'FILL_BLANK',
]);

/** Loại phiên học — phân tích thời gian sử dụng theo loại hoạt động. */
export const sessionTypeEnum = pgEnum('session_type', [
  'CHAT',
  'FLASHCARD',
  'QUIZ',
  'READING',
]);

// Phase 13 — Study Rooms (realtime video call + collab)
export const roomTypeEnum = pgEnum('room_type', [
  'STUDY',         // học nhóm tự do
  'CLASSROOM',     // giáo viên dạy nhiều học sinh
  'EXAM',          // phòng làm bài (Phase 17 live exam)
  'OFFICE_HOURS',  // hỗ trợ 1-1 / Q&A
]);

export const roomVisibilityEnum = pgEnum('room_visibility', [
  'PRIVATE',   // chỉ member được mời mới join
  'UNLISTED',  // ai có link/joinCode đều join được, không list public
  'PUBLIC',    // hiện trên explore page (Phase 14+)
]);

export const roomStatusEnum = pgEnum('room_status', [
  'IDLE',    // tạo xong, chưa ai vào
  'ACTIVE',  // đang có người trong room
  'ENDED',   // session kết thúc (mọi người leave)
]);

export const roomMemberRoleEnum = pgEnum('room_member_role', [
  'OWNER',      // người tạo room, full quyền
  'MODERATOR',  // có thể kick/mute, không xoá room
  'MEMBER',     // tham gia bình thường
]);

export const roomMemberStatusEnum = pgEnum('room_member_status', [
  'ACTIVE',   // đang là member hợp lệ
  'PENDING',  // chờ approve (room có requireApproval)
  'KICKED',   // bị mod kick, không vào lại được tới khi unban
  'BANNED',   // permanent ban
]);

// ──────────────────────────────────────────────────────────
// Better Auth — bảng do thư viện auth quản lý
// (cấu trúc cột phải khớp better-auth/adapters/drizzle)
// ──────────────────────────────────────────────────────────
/**
 * Bảng user — Better Auth khởi tạo các cột cơ bản, Cogniva mở rộng thêm
 * `plan` + `preferences`. KHÔNG đổi tên cột cơ bản hoặc auth sẽ vỡ.
 */
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  // Mở rộng cho Cogniva — Better Auth bỏ qua những cột nó không biết
  plan: planEnum('plan').notNull().default('FREE'),
  /** Profile có public hay không — control leaderboard + profile visibility. */
  isPublic: boolean('is_public').notNull().default(false),
  preferences: jsonb('preferences').$type<UserPreferences>().default({}).notNull(),
  // ── COPPA (Plan v2 §3.7.2) ─────────────────────────────
  /**
   * Ngày sinh — required cho user mới. Legacy user trước migration: NULL,
   * treat as NOT_REQUIRED (giả định adult).
   */
  dateOfBirth: timestamp('date_of_birth', { mode: 'date' }),
  /** Status parental consent — driven bởi age tại signup. */
  parentalConsentStatus: parentalConsentStatusEnum('parental_consent_status')
    .notNull()
    .default('NOT_REQUIRED'),
  /** Email cha mẹ — chỉ set nếu age < 13. KHÔNG verify cha mẹ là Cogniva user. */
  parentEmail: text('parent_email'),
  /** Khi parent verify thành công (status → VERIFIED). */
  parentalConsentAt: timestamp('parental_consent_at'),
  // ─────────────────────────────────────────────────────────
  // ── V2 G3 presence status (2026-05-21) ─────────────────
  /** Trạng thái hiển thị: online (default) / idle / dnd / offline / invisible. */
  status: text('status').notNull().default('online'),
  /** Custom status text user tự gõ (vd "Đang ôn thi cuối kỳ"). */
  statusText: text('status_text'),
  /** Custom status emoji (1 char). */
  statusEmoji: text('status_emoji'),
  /** Auto-clear status sau timestamp này (NULL = không expire). */
  statusExpiresAt: timestamp('status_expires_at'),
  // ─────────────────────────────────────────────────────────
  // ── Admin console (Phase 0) ────────────────────────────
  /**
   * Vai trò admin — NULL = user thường (mặc định mọi signup).
   * Khi NOT NULL → user có quyền vào /admin/* với scope tương ứng:
   *   SUPER_ADMIN — toàn quyền (delete user, refund, kill switch)
   *   ADMIN      — KYC review, content moderation
   *   SUPPORT    — view-only
   */
  adminRole: text('admin_role'),
  /** Soft suspend — user không sign-in được, data giữ nguyên 30 ngày. */
  suspendedAt: timestamp('suspended_at'),
  suspendReason: text('suspend_reason'),
  /**
   * Phase 6 — 2FA TOTP enabled. Quản lý qua better-auth twoFactor plugin.
   * KHÔNG set bằng tay — plugin tự update khi verify thành công.
   */
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  /**
   * V4 T4 (2026-05-22): token để export booking calendar iCal feed.
   * Lazy create khi user click "Subscribe lịch học" — rotate quarterly admin.
   */
  bookingIcalToken: text('booking_ical_token'),
  // ─────────────────────────────────────────────────────────
  // ── Library Phase 4 Step 5 — PRO subscription expiry ───
  /**
   * PRO subscription hết hạn lúc nào. NULL = chưa từng PRO.
   * Cron daily check < NOW() → downgrade plan FREE.
   * Khi user subscribe lại → extend (nếu còn hạn) hoặc reset (nếu đã hết).
   */
  proUntilAt: timestamp('pro_until_at'),
  // ─────────────────────────────────────────────────────────
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * twoFactor — store TOTP secret + backup codes cho user enable 2FA.
 * Managed bởi better-auth twoFactor plugin. KHÔNG truy cập trực tiếp từ app
 * code — chỉ qua `authClient.twoFactor.*`.
 */
export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    verified: boolean('verified').notNull().default(true),
  },
  (t) => ({
    userIdx: index('idx_two_factor_user').on(t.userId),
  }),
);

/** Phiên đăng nhập — token được lưu cookie phía client. */
export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Tài khoản OAuth hoặc credentials — 1 user có thể có nhiều account
 * (ví dụ Google + email). Cột `password` chỉ điền với provider "credentials".
 */
export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** Verification token — dùng cho xác thực email, magic link, reset password. */
export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * jwks — JSON Web Key Set storage cho Better Auth JWT plugin (Stage 2 M4 W3).
 *
 * JWT plugin tự generate keypair (Ed25519 default) khi server start lần đầu,
 * lưu vào table này. Public key expose qua /api/auth/jwks (edge gateway +
 * mobile app verify JWT). Private key encrypted-at-rest bằng BETTER_AUTH_SECRET.
 *
 * Rotation: optional, set qua plugin `rotationInterval`. Khi rotate, key cũ
 * giữ trong grace period 30 ngày để JWT đã issue vẫn verify được.
 */
export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
});

// ──────────────────────────────────────────────────────────
// Domain — Workspace + Document + Chunk
// ──────────────────────────────────────────────────────────
/**
 * Không gian làm việc — gom nhóm tài liệu theo môn học/chủ đề.
 * Một user có nhiều workspace; xoá workspace sẽ cascade xoá document.
 */
export const workspace = pgTable(
  'workspace',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // Truy vấn list workspace của 1 user → cần index theo userId
    userIdx: index('workspace_user_idx').on(t.userId),
  }),
);

/**
 * workspaceCachedOutput — V6 (NotebookLM layout): persistent cache cho
 * LLM-generated markdown (atom-guide / briefing-doc). Trước V6 dùng
 * in-memory Map nên restart server mất sạch.
 *
 * Spec: docs/plans/v5-notebooklm-layout.md V6.5.
 *
 * Key compound (workspace × user × kind) — 1 row/cache entry. TTL check
 * ở app layer (24h) qua `generatedAt`.
 */
export const workspaceCachedKindEnum = pgEnum('workspace_cached_kind', [
  'atom-guide',
  'briefing',
]);

export const workspaceCachedOutput = pgTable(
  'workspace_cached_output',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: workspaceCachedKindEnum('kind').notNull(),
    markdown: text('markdown').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    generatedAt: timestamp('generated_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('workspace_cached_uniq').on(t.workspaceId, t.userId, t.kind),
  }),
);

/**
 * Tài liệu đã upload (PDF/DOCX/URL/Youtube). storageKey trỏ tới object trên R2.
 * Trường status điều khiển UI: PROCESSING hiển thị spinner, READY mới cho mở.
 */
export const document = pgTable(
  'document',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    /** Key của object trên Cloudflare R2 — không phải URL công khai. */
    storageKey: text('storage_key').notNull(),
    status: docStatusEnum('status').notNull().default('PROCESSING'),
    metadata: jsonb('metadata').$type<DocumentMetadata>().default({}).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // Liệt kê tài liệu trong 1 workspace của user — query phổ biến nhất
    userWorkspaceIdx: index('document_user_workspace_idx').on(t.userId, t.workspaceId),
  }),
);

/**
 * Đoạn nhỏ (chunk) sau khi cắt tài liệu — đơn vị retrieval cho RAG.
 * Mỗi chunk có embedding 3072 chiều (text-embedding-3-large) + tsvector cho
 * full-text search. Hybrid retrieval kết hợp 2 chỉ mục này.
 */
export const chunk = pgTable(
  'chunk',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    documentId: text('document_id')
      .notNull()
      .references(() => document.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    embedding: vector('embedding', 1024),
    metadata: jsonb('metadata').$type<ChunkMetadata>().notNull(),
    /** Số token (tính theo tokenizer của OpenAI) — phục vụ tính chi phí + giới hạn context. */
    tokens: integer('tokens').notNull(),
  },
  (t) => ({
    docIdx: index('chunk_doc_idx').on(t.documentId),
    // HNSW index cho ANN search — cosine similarity là metric chuẩn cho text embedding
    embeddingIdx: index('chunk_embedding_idx').using(
      'hnsw',
      sql`${t.embedding} vector_cosine_ops`,
    ),
    // GIN index trên tsvector của content → BM25-like full-text search
    contentTsvIdx: index('chunk_content_tsv_idx').using(
      'gin',
      sql`to_tsvector('english', ${t.content})`,
    ),
  }),
);

// ──────────────────────────────────────────────────────────
// Pivot — Chunk ↔ Concept (1 chunk có thể liên quan nhiều concept)
// ──────────────────────────────────────────────────────────
/**
 * Bảng nối nhiều-nhiều giữa chunk và concept. Lý do dùng pivot table thay
 * vì lưu mảng conceptIds trong chunk.metadata:
 *   - Query "concept X có chunks nào" cần index ngược → metadata jsonb scan
 *     tệ. Pivot có index riêng, scale tốt khi DB lớn.
 *   - Có thể thêm field strength (độ liên quan) sau, không phá schema.
 *
 * Quan hệ tạo bởi job extract-concepts (Phase 4) khi LLM scan chunks.
 */
export const chunkConcept = pgTable(
  'chunk_concept',
  {
    chunkId: text('chunk_id')
      .notNull()
      .references(() => chunk.id, { onDelete: 'cascade' }),
    conceptId: text('concept_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    /** Độ liên quan chunk ↔ concept (0..1) — LLM judge hoặc default 1.0. */
    strength: real('strength').notNull().default(1),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chunkId, t.conceptId] }),
    // Truy ngược "concept này có chunks nào" — query phổ biến khi click node graph
    conceptIdx: index('chunk_concept_concept_idx').on(t.conceptId),
  }),
);

// ──────────────────────────────────────────────────────────
// Domain — Concept (graph kiến thức) + Mastery
// ──────────────────────────────────────────────────────────
/**
 * Một khái niệm trong knowledge graph — ví dụ "Định lý Pythagoras".
 * Embedding để dedup: khi extract concept từ tài liệu mới, nếu cosine
 * similarity > 0.85 với concept có sẵn → coi là cùng concept, không tạo mới.
 */
/**
 * Concept = ATOM kiến thức (đơn vị share giữa Flashcard / Quiz / Exam /
 * Graph / Study Plan). Sau migration 0031, concept "lên cấp" từ "node
 * graph" thành atom đầy đủ: có examples cụ thể, difficulty estimate,
 * preview Q/A để hiển thị độc lập ở UI.
 *
 * Spec: docs/plans/atom-centric.md §3.2.
 *
 * Giữ tên `concept` ở DB level để tránh rename ~50 file references; UI
 * layer dùng label "atom".
 */
export const concept = pgTable(
  'concept',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    name: text('name').notNull(),
    description: text('description'),
    /** Lĩnh vực — "math", "biology", "history"… dùng để filter graph. */
    domain: text('domain').notNull(),
    embedding: vector('embedding', 1024),
    /** 1-3 ví dụ cụ thể minh hoạ atom — show ở UI atom detail. */
    examples: jsonb('examples').$type<string[]>().notNull().default([]),
    /** Độ khó ước lượng (0..1) — LLM estimate lúc extract. Dùng cho study
     *  plan: ưu tiên atom khó user chưa làm; UI difficulty badge. */
    difficulty: real('difficulty'),
    /** Q ngắn để show "đây là gì?" preview, không cần JOIN flashcard. */
    previewQuestion: text('preview_question'),
    previewAnswer: text('preview_answer'),
  },
  (t) => ({
    embeddingIdx: index('concept_embedding_idx').using(
      'hnsw',
      sql`${t.embedding} vector_cosine_ops`,
    ),
    difficultyIdx: index('concept_difficulty_idx').on(t.difficulty),
  }),
);

/**
 * Quan hệ giữa 2 concept — dạng directed edge trong knowledge graph.
 * relationType: "prerequisite" (B cần biết A trước), "related" (liên quan
 * không bắt buộc), "specializes" (B là dạng cụ thể của A).
 */
export const conceptRelation = pgTable(
  'concept_relation',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    fromId: text('from_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    toId: text('to_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    relationType: text('relation_type').notNull(),
    /** Độ mạnh quan hệ (0..1) — điều khiển độ dày cạnh trong graph viz. */
    strength: real('strength').notNull().default(1),
  },
  (t) => ({
    // Không cho phép trùng cạnh same direction + same type
    uniq: uniqueIndex('concept_relation_uniq').on(t.fromId, t.toId, t.relationType),
  }),
);

/**
 * Bảng mastery: 1 dòng / (user × concept).
 *
 * `score` là posterior probability từ Bayesian Knowledge Tracing — cập nhật
 * mỗi khi user trả lời quiz/flashcard liên quan đến concept đó. Có forgetting
 * curve áp dụng giữa các phiên (decay theo e^(-t/half_life)).
 */
export const mastery = pgTable(
  'mastery',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    conceptId: text('concept_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    /** Xác suất user đã thành thạo concept (0..1, BKT estimate). */
    score: real('score').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    correct: integer('correct').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at'),
    /** Mốc thời gian áp decay gần nhất — tránh decay nhiều lần. */
    decayedAt: timestamp('decayed_at'),
    /** Migration 0033 — track timestamp lần cuối user attempt qua từng
     *  feature, phục vụ study plan đa dạng hoá format + analytics. */
    lastQuizAt: timestamp('last_quiz_at'),
    lastFlashcardAt: timestamp('last_flashcard_at'),
    lastExamAt: timestamp('last_exam_at'),
  },
  (t) => ({
    uniq: uniqueIndex('mastery_user_concept_uniq').on(t.userId, t.conceptId),
  }),
);

// ──────────────────────────────────────────────────────────
// Domain — Conversation + Message
// ──────────────────────────────────────────────────────────
/** Cuộc hội thoại — gom các message của 1 luồng chat. */
export const conversation = pgTable(
  'conversation',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * Có thể null nếu là chat global; set null khi workspace bị xoá để
     * không mất lịch sử hội thoại của user.
     */
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    title: text('title'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    /**
     * Liệt kê hội thoại của 1 user theo thời gian (sidebar chat, analytics join).
     * Postgres KHÔNG tự index cột FK → thiếu index này = seq-scan toàn bảng.
     */
    userCreatedIdx: index('conversation_user_created_idx').on(t.userId, t.createdAt),
  }),
);

/**
 * Mỗi message trong cuộc hội thoại — citation lưu list chunk làm nguồn,
 * metadata lưu thông tin chi phí/độ trễ để dashboard observability.
 */
export const message = pgTable(
  'message',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<Citation[]>().default([]).notNull(),
    metadata: jsonb('metadata').$type<MessageMetadata>().default({}).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    /**
     * Load 1 cuộc chat: WHERE conversation_id=X ORDER BY created_at.
     * Cũng phục vụ analytics join message→conversation (scan theo cost/30 ngày).
     * Thiếu index này = seq-scan toàn bảng message (bảng lớn nhất hệ thống).
     */
    convCreatedIdx: index('message_conv_created_idx').on(t.conversationId, t.createdAt),
  }),
);

// ──────────────────────────────────────────────────────────
// Domain — Flashcard (FSRS) + Review
// ──────────────────────────────────────────────────────────
/**
 * Flashcard — đơn vị spaced repetition. Các trường difficulty/stability/
 * retrievability/state là tham số nội tại của FSRS algorithm (ts-fsrs).
 *
 * Trường `due` là mốc lần review kế tiếp; query daily queue:
 *   SELECT * FROM flashcard WHERE userId = ? AND due <= NOW() ORDER BY due
 */
export const flashcard = pgTable(
  'flashcard',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * Workspace chứa flashcard này (Phase Workspace-centric).
     * Nullable: thẻ có thể "global" (không thuộc workspace nào — vd thẻ tạo
     * thủ công nhanh). Workspace bị xoá → set null (giữ thẻ lại trong "Personal").
     */
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    conceptId: text('concept_id').references(() => concept.id, { onDelete: 'set null' }),
    front: text('front').notNull(),
    back: text('back').notNull(),
    cardType: cardTypeEnum('card_type').notNull().default('BASIC'),
    /** Chunk gốc đã sinh ra thẻ này — dùng để show nguồn khi review. */
    sourceChunkId: text('source_chunk_id').references(() => chunk.id, {
      onDelete: 'set null',
    }),
    // ── Tham số FSRS ────────────────────────────────────
    difficulty: real('difficulty').notNull().default(0),
    stability: real('stability').notNull().default(0),
    retrievability: real('retrievability').notNull().default(0),
    state: fsrsStateEnum('state').notNull().default('NEW'),
    due: timestamp('due').notNull().defaultNow(),
    lastReview: timestamp('last_review'),
  },
  (t) => ({
    // Composite index cho daily review queue
    userDueIdx: index('flashcard_user_due_idx').on(t.userId, t.due),
    // Composite index cho query workspace-scoped list
    userWorkspaceIdx: index('flashcard_user_workspace_idx').on(t.userId, t.workspaceId),
  }),
);

/**
 * Lịch sử review từng thẻ — phục vụ phân tích progress + retrain FSRS sau này.
 * rating theo thang FSRS: 1=Again, 2=Hard, 3=Good, 4=Easy.
 */
export const review = pgTable('review', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  flashcardId: text('flashcard_id')
    .notNull()
    .references(() => flashcard.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  /** Thời gian (ms) user mất để trả lời — proxy cho confidence/độ khó. */
  duration: integer('duration').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────
// Domain — Quiz + Question
// ──────────────────────────────────────────────────────────
/** Quiz là tập hợp câu hỏi do AI sinh từ 1 hoặc nhiều concept. */
export const quiz = pgTable(
  'quiz',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * Workspace chứa quiz này (Phase Workspace-centric).
     * Nullable — quiz có thể "global". Workspace xoá → set null.
     */
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    config: jsonb('config').$type<QuizConfig>().default({}).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userWorkspaceIdx: index('quiz_user_workspace_idx').on(t.userId, t.workspaceId),
  }),
);

/**
 * 1 câu hỏi trong quiz. correctAnswer là JSON để hỗ trợ nhiều dạng:
 *  - MCQ:    số (index) hoặc mảng (multi-select)
 *  - SHORT:  chuỗi với danh sách từ khoá chấp nhận
 *  - ESSAY:  rubric chấm điểm
 */
export const question = pgTable('question', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quizId: text('quiz_id')
    .notNull()
    .references(() => quiz.id, { onDelete: 'cascade' }),
  type: questionTypeEnum('type').notNull(),
  prompt: text('prompt').notNull(),
  /** Danh sách lựa chọn cho MCQ — null với các loại khác. */
  options: jsonb('options').$type<string[] | null>(),
  correctAnswer: jsonb('correct_answer').notNull(),
  explanation: text('explanation').notNull(),
  conceptId: text('concept_id').references(() => concept.id, { onDelete: 'set null' }),
  /** Độ khó câu hỏi (0..1) — adaptive engine sẽ chọn phù hợp với mastery. */
  difficulty: real('difficulty').notNull(),
});

/**
 * 1 lần user làm 1 quiz. Trước đây quiz KHÔNG lưu attempt (chỉ log studySession
 * metadata) → không biết câu nào "đã làm". Bảng này + `quiz_response` cho phép
 * quản trị "đã làm/chưa làm" từng câu + xem lại điểm. (Nhẹ hơn exam_attempt —
 * quiz không có anti-cheat/adaptive/proctor.)
 */
export const quizAttempt = pgTable(
  'quiz_attempt',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quiz.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    submittedAt: timestamp('submitted_at'),
    /** Số câu đúng. */
    score: real('score'),
    /** Tổng số câu chấm. */
    maxScore: real('max_score'),
    /** % = score/maxScore (cache cho list quản trị). */
    percentage: real('percentage'),
  },
  (t) => ({
    quizUserIdx: index('quiz_attempt_quiz_user_idx').on(t.quizId, t.userId),
    userIdx: index('quiz_attempt_user_idx').on(t.userId),
  }),
);

/**
 * Câu trả lời của user cho 1 câu hỏi trong 1 lần làm quiz. `userId` lặp lại (từ
 * attempt) để query "câu nào user đã làm" nhanh, không cần join attempt.
 * Upsert theo (attemptId, questionId) — 1 response / câu / lần làm.
 */
export const quizResponse = pgTable(
  'quiz_response',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    /**
     * Thuộc 1 lần làm quiz đầy đủ (quiz_attempt). NULLABLE: quick-quiz chấm từng
     * câu rời (cross-quiz, không gom thành 1 attempt) → ghi marker "đã làm" với
     * attemptId=null. "Đã làm" của 1 câu = EXISTS response của (userId, questionId).
     */
    attemptId: text('attempt_id').references(() => quizAttempt.id, {
      onDelete: 'cascade',
    }),
    questionId: text('question_id')
      .notNull()
      .references(() => question.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    answer: jsonb('answer'),
    isCorrect: boolean('is_correct'),
    answeredAt: timestamp('answered_at').notNull().defaultNow(),
  },
  (t) => ({
    attemptQuestionIdx: uniqueIndex('quiz_response_attempt_question_idx').on(
      t.attemptId,
      t.questionId,
    ),
    userQuestionIdx: index('quiz_response_user_question_idx').on(t.userId, t.questionId),
    // Marker quick-quiz (attemptId NULL): tối đa 1 / (user, câu) → upsert
    // idempotent, chống chấm đồng thời tạo nhiều row trùng. Partial vì full
    // attempt (attemptId set) đã có attemptQuestionIdx.
    quickMarkerIdx: uniqueIndex('quiz_response_user_question_quick_idx')
      .on(t.userId, t.questionId)
      .where(sql`${t.attemptId} IS NULL`),
  }),
);

// ──────────────────────────────────────────────────────────
// Domain — StudySession (tracking thời gian học)
// ──────────────────────────────────────────────────────────
/**
 * 1 phiên học — dùng cho heatmap/biểu đồ thời gian + streak.
 * sessionType phân loại để analytics có thể tách "đọc" với "luyện thẻ".
 */
export const studySession = pgTable('study_session', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  sessionType: sessionTypeEnum('session_type').notNull(),
  metadata: jsonb('metadata').default({}).notNull(),
});

// ──────────────────────────────────────────────────────────
// Domain — Notes (Phase 7)
// ──────────────────────────────────────────────────────────
/**
 * Note — văn bản tự do của user, viết bằng TipTap (HTML hoặc markdown).
 * Liên kết optional với 1 concept (note về 1 khái niệm) hoặc 1 document
 * (note đính kèm tài liệu, hiển thị sidebar khi mở doc).
 */
export const note = pgTable(
  'note',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * Workspace chứa note (Phase Workspace-centric).
     * Nullable cho "Personal" notes (journal, ý tưởng nhanh không gắn môn nào).
     * Workspace xoá → set null (note giữ lại).
     */
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /** TipTap HTML content — render trực tiếp trong viewer. */
    content: text('content').notNull(),
    conceptId: text('concept_id').references(() => concept.id, { onDelete: 'set null' }),
    documentId: text('document_id').references(() => document.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('note_user_idx').on(t.userId),
    updatedIdx: index('note_updated_idx').on(t.userId, t.updatedAt),
    userWorkspaceIdx: index('note_user_workspace_idx').on(t.userId, t.workspaceId),
  }),
);

// ──────────────────────────────────────────────────────────
// Domain — Study Plan (Phase 7)
// ──────────────────────────────────────────────────────────
/**
 * Mục trong kế hoạch học — user tự tạo hoặc AI gợi ý.
 * status: PENDING / DONE — UI tick checkbox. dueDate optional (deadline).
 * conceptId optional (gắn với 1 khái niệm để link sang quiz/flashcard).
 */
export const studyPlanStatusEnum = pgEnum('study_plan_status', [
  'PENDING',
  'DONE',
  'SKIPPED', // Phase B (atom-centric): user "swap" 1 AI proposal sang
             // alternative — mark item cũ SKIPPED rồi propose lại.
]);

/**
 * Loại study plan item:
 *   - 'manual'   : user tự gõ todo (row cũ trước Phase B đều mark 'manual')
 *   - 'review'   : AI propose atom due SRS (flashcard.due <= today)
 *   - 'new'      : AI propose atom user chưa biết (chưa có mastery row)
 *   - 'practice' : AI propose quiz cho atom yếu (mastery.score < 0.5)
 */
export const studyPlanKindEnum = pgEnum('study_plan_kind', [
  'manual',
  'review',
  'new',
  'practice',
]);

export const studyPlanItem = pgTable(
  'study_plan_item',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    conceptId: text('concept_id').references(() => concept.id, { onDelete: 'set null' }),
    status: studyPlanStatusEnum('status').notNull().default('PENDING'),
    /**
     * Phase B (atom-centric): phân loại nguồn item. Default 'manual' để
     * row cũ tự classify đúng. UI render mỗi kind ở section riêng.
     */
    kind: studyPlanKindEnum('kind').notNull().default('manual'),
    /**
     * Bổ sung context AI: why_proposed, atom_difficulty, estimated_minutes,
     * mastery_score, etc. Không tạo column riêng cho mỗi field.
     */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    dueDate: timestamp('due_date'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (t) => ({
    userStatusIdx: index('study_plan_user_status_idx').on(t.userId, t.status),
    dueIdx: index('study_plan_due_idx').on(t.userId, t.dueDate),
  }),
);

// ──────────────────────────────────────────────────────────
// Domain — Gamification (Phase 9)
// ──────────────────────────────────────────────────────────
/**
 * userStats — 1 dòng / user, lưu XP + streak + achievements.
 *
 * Tách bảng riêng (thay vì cột trong `user`) để:
 *   - Tránh đụng schema user (Better Auth managed).
 *   - Truy vấn leaderboard nhanh hơn (index trên xp).
 *
 * `achievements`: text[] chứa các achievement ID đã unlock (vd 'first_quiz',
 * 'streak_7'). Hardcoded list trong `lib/gamification/achievements.ts`.
 *
 * `lastActivityDate` = ngày Y-M-D của activity gần nhất (timezone server).
 * Streak break khi gap > 1 ngày.
 */
export const userStats = pgTable(
  'user_stats',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    xp: integer('xp').notNull().default(0),
    currentStreak: integer('current_streak').notNull().default(0),
    longestStreak: integer('longest_streak').notNull().default(0),
    lastActivityDate: text('last_activity_date'), // YYYY-MM-DD
    achievements: text('achievements').array().notNull().default(sql`'{}'::text[]`),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    xpIdx: index('user_stats_xp_idx').on(t.xp),
  }),
);

/**
 * Nhóm học — Discord-style server (Phase 20).
 *
 * Phase 9 v1 chỉ là list member + invite code đơn. Phase 20 mở rộng:
 *   - icon/banner URL — branding cho group
 *   - is_public        — có hiện trong /groups/explore không (V2)
 *   - max_members      — soft limit theo tier (FREE 100, PRO 500, TEAM 1000)
 *   - inviteCode legacy giữ lại để link cũ không vỡ; multi-invite mới qua
 *     bảng study_group_invite (max_uses + expiry).
 */
export const studyGroup = pgTable(
  'study_group',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    name: text('name').notNull(),
    description: text('description'),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Legacy invite token — giữ lại cho backward compat. New flow dùng studyGroupInvite. */
    inviteCode: text('invite_code').notNull().unique(),
    /** Icon URL hiển thị trong sidebar groups (avatar tròn 48x48). */
    iconUrl: text('icon_url'),
    /** Banner URL ở đầu group settings page (1500x500). */
    bannerUrl: text('banner_url'),
    /** Nếu TRUE → hiện trong public explore (V2 feature). */
    isPublic: boolean('is_public').notNull().default(false),
    /** Hard limit số member. Default 100 cho FREE plan. */
    maxMembers: integer('max_members').notNull().default(100),
    /**
     * Channel nhận log recording (Phase 20 V3). Owner chọn 1 TEXT channel để
     * AI Tutor post system message khi voice recording xong. NULL = fallback
     * TEXT channel đầu tiên theo position. ON DELETE SET NULL.
     */
    recordingLogChannelId: text('recording_log_channel_id'),
    /**
     * Phase 2 admin moderation — set khi admin suspend group. NULL = active.
     * Member không gửi được message khi suspended_at != NULL.
     */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendReason: text('suspend_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    inviteIdx: index('study_group_invite_idx').on(t.inviteCode),
  }),
);

/**
 * Vai trò trong group — hierarchy:
 *   OWNER     → full quyền, không xoá được trừ self leave
 *   ADMIN     → quản trị channel + member, không xoá owner / không thay role owner
 *   MODERATOR → delete msg, mute, không CRUD channel / không thay role
 *   MEMBER    → chat, voice, react
 */
export const groupRoleEnum = pgEnum('group_role', ['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER']);

export const studyGroupMember = pgTable(
  'study_group_member',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    groupId: text('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: groupRoleEnum('role').notNull().default('MEMBER'),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    /** Per-group display name — override user.name khi hiện trong group. */
    nickname: text('nickname'),
    /** Mute tới timestamp này — read-only chat trong group, auto-clear khi quá hạn. */
    mutedUntil: timestamp('muted_until'),
    /** Last online ping — dùng cho online status indicator (V2 — fallback presence Pusher). */
    lastSeenAt: timestamp('last_seen_at'),
  },
  (t) => ({
    uniq: uniqueIndex('study_group_member_uniq').on(t.groupId, t.userId),
    userIdx: index('study_group_member_user_idx').on(t.userId),
  }),
);

// ──────────────────────────────────────────────────────────
// Phase 20 V2 — Direct Messages (1-1 chat)
// ──────────────────────────────────────────────────────────

/**
 * DM thread giữa 2 user. Convention `user1_id < user2_id` để unique cặp
 * không phụ thuộc thứ tự — chỉ 1 thread cho mỗi cặp dù A start hay B start.
 *
 * Caller helper: `orderUserIds(a, b)` → [smaller, larger] trước khi query/insert.
 */
export const dmThread = pgTable(
  'dm_thread',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    user1Id: text('user1_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    user2Id: text('user2_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    /** Update mỗi lần insert message — dùng sort thread list theo activity. */
    lastMessageAt: timestamp('last_message_at').notNull().defaultNow(),
  },
  (t) => ({
    usersUniq: uniqueIndex('dm_thread_users_uniq').on(t.user1Id, t.user2Id),
    user1LastIdx: index('dm_thread_user1_last_idx').on(t.user1Id, t.lastMessageAt),
    user2LastIdx: index('dm_thread_user2_last_idx').on(t.user2Id, t.lastMessageAt),
  }),
);

export const dmMessage = pgTable(
  'dm_message',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    threadId: text('thread_id')
      .notNull()
      .references(() => dmThread.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    replyToId: text('reply_to_id'),
    attachments: jsonb('attachments').$type<Array<{
      type: 'image' | 'file' | 'audio' | 'video';
      url: string;
      name: string;
      size: number;
      mime: string;
    }>>(),
    reactions: jsonb('reactions').$type<Record<string, string[]>>(),
    editedAt: timestamp('edited_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    threadTimeIdx: index('dm_message_thread_time_idx').on(t.threadId, t.createdAt),
  }),
);

export const dmReadState = pgTable(
  'dm_read_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => dmThread.id, { onDelete: 'cascade' }),
    lastReadMessageId: text('last_read_message_id'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.threadId] }),
  }),
);

// ──────────────────────────────────────────────────────────
// Phase 20 — Study Group Channels (Discord-style)
// ──────────────────────────────────────────────────────────

/**
 * Loại channel trong group:
 *   - TEXT          : chat thông thường (mặc định mọi member post được)
 *   - VOICE         : LiveKit room — audio/video/screen share
 *   - ANNOUNCEMENT  : chỉ admin post (member chỉ đọc + react) — V2 wire
 */
export const channelTypeEnum = pgEnum('channel_type', ['TEXT', 'VOICE', 'ANNOUNCEMENT', 'STAGE', 'FORUM']);

/**
 * Category gom channel — Discord-style folder collapsible.
 * V2: 1 channel thuộc 0..1 category. NULL category = root level.
 */
export const studyGroupCategory = pgTable(
  'study_group_category',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    groupId: text('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    groupPosIdx: index('study_group_category_group_pos_idx').on(t.groupId, t.position),
  }),
);

/**
 * Channel trong group — đơn vị nhỏ nhất user "vào" để chat/voice.
 *
 * Khác `room` (Phase 13):
 *   - room    = ephemeral standalone (có owner riêng, scheduled, recurring)
 *   - channel = persistent fixture trong group (không lifecycle độc lập)
 *
 * Convention:
 *   - VOICE channel: livekitRoomName = 'group:{id}' để khớp 1-1 với LiveKit.
 *   - position: 0..N, drag-drop reorder update bulk.
 */
export const studyGroupChannel = pgTable(
  'study_group_channel',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    groupId: text('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    /** Tên channel (vd 'chung', 'toán-cao-cấp'). Slug-style, không space. */
    name: text('name').notNull(),
    type: channelTypeEnum('type').notNull(),
    /** Mô tả ngắn dưới header — placeholder cho mục đích channel. */
    topic: text('topic'),
    /** Thứ tự trong sidebar (nhỏ nhất trên cùng). Drag-drop update. */
    position: integer('position').notNull().default(0),
    /** Private channel: chỉ user có override-permission mới thấy. V2. */
    isPrivate: boolean('is_private').notNull().default(false),
    /** Slow mode — giây delay giữa 2 message của cùng user. NULL = off. */
    slowModeSeconds: integer('slow_mode_seconds'),
    /** Người tạo channel — set NULL nếu user xoá account (không cascade xoá channel). */
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    /** LiveKit room name cho VOICE channel — convention 'group:{channelId}'. */
    livekitRoomName: text('livekit_room_name'),
    /** Max participants VOICE channel — NULL = không giới hạn (chỉ LiveKit plan limit). */
    voiceMaxParticipants: integer('voice_max_participants'),
    /** V2: thuộc category nào (NULL = root level). */
    categoryId: text('category_id'),
    /**
     * V3 Forum: list tag mod tạo sẵn cho channel — user pick khi tạo post.
     * Format: [{ name: 'help', color: 'amber' }, ...]. NULL = chưa có tag.
     */
    availableTags: jsonb('available_tags').$type<Array<{ name: string; color?: string }>>(),
  },
  (t) => ({
    groupPosIdx: index('study_group_channel_group_pos_idx').on(t.groupId, t.position),
    /** Mỗi LiveKit room map vào 1 channel duy nhất — partial unique (NULL OK). */
    livekitIdx: uniqueIndex('study_group_channel_livekit_idx').on(t.livekitRoomName),
  }),
);

/**
 * Tin nhắn trong TEXT/ANNOUNCEMENT channel.
 *
 * Field chính:
 *   - contentType : 'text' | 'markdown' — V1 default markdown render basic.
 *   - replyToId   : reply tới 1 message khác, render thread chip.
 *   - attachments : [{type, url, name, size, mime}] — V2 wire R2 upload.
 *   - reactions   : { '👍': [uid1, uid2], '❤️': [uid3] } — atomic UPDATE jsonb.
 *   - mentions    : [{type: 'user'|'channel'|'everyone', id}] — push notify.
 *   - deletedAt   : soft delete giữ thread context, hard delete 30d Inngest cron.
 */
export const studyGroupMessage = pgTable(
  'study_group_message',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    channelId: text('channel_id')
      .notNull()
      .references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    contentType: text('content_type').notNull().default('markdown'),
    replyToId: text('reply_to_id'),
    attachments: jsonb('attachments').$type<Array<{
      type: 'image' | 'file' | 'audio' | 'video';
      url: string;
      name: string;
      size: number;
      mime: string;
    }>>(),
    reactions: jsonb('reactions').$type<Record<string, string[]>>(),
    pinned: boolean('pinned').notNull().default(false),
    mentions: jsonb('mentions').$type<Array<{ type: 'user' | 'channel' | 'everyone'; id: string }>>(),
    editedAt: timestamp('edited_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    // ── Phase 20 V2: Threads ──
    /** NULL = root message; có giá trị = reply trong thread của message X. */
    threadRootId: text('thread_root_id'),
    /** (chỉ trên root) số reply trong thread, dùng cho badge "X replies". */
    threadCount: integer('thread_count').notNull().default(0),
    /** (chỉ trên root) timestamp reply gần nhất, sort thread list. */
    threadLastAt: timestamp('thread_last_at'),
    // ── Phase 20 V3: Forum ──
    /** Tiêu đề post forum. NULL trừ message gốc trong FORUM channel. */
    title: text('title'),
    /** Tag slug list của forum post. NULL = không tag. */
    tags: jsonb('tags').$type<string[]>(),
    /**
     * V2 G5 (2026-05-21): forum solution-mark.
     * Một reply trong thread forum có thể được đánh dấu là solution
     * (Discord pattern). Chỉ 1 solution / thread — API enforce.
     */
    isSolution: boolean('is_solution').notNull().default(false),
    /**
     * V2 G6.3 (2026-05-21): thread archive (Discord-style).
     * Inngest cron daily set NOW() khi thread_last_at < NOW() - 7 ngày.
     * Reply mới vào archived thread → API auto-clear (set null) — unarchive.
     */
    archivedAt: timestamp('archived_at'),
  },
  (t) => ({
    channelTimeIdx: index('study_group_message_channel_time_idx').on(t.channelId, t.createdAt),
    authorIdx: index('study_group_message_author_idx').on(t.authorId),
    threadIdx: index('study_group_message_thread_idx').on(t.threadRootId, t.createdAt),
  }),
);

/**
 * Read state per (user, channel) — track lastReadMessageId.
 *
 * Unread badge logic:
 *   count msg WHERE channel_id=X AND created_at > (msg of lastReadMessageId).created_at
 *
 * Tối ưu: render lazy → chỉ tính unread khi user load group page, cache 30s Redis.
 */
export const studyGroupReadState = pgTable(
  'study_group_read_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    lastReadMessageId: text('last_read_message_id'),
    /** User mute channel này — không hiện unread badge + không push. */
    muted: boolean('muted').notNull().default(false),
    /**
     * V2 G4 (2026-05-21): per-channel notification preference Discord-style.
     *   - 'all'      → push tất cả message (default)
     *   - 'mentions' → chỉ push khi user được @mention
     *   - 'none'     → tắt toàn bộ push (vẫn vào notification log)
     *
     * Legacy `muted` boolean backward-compat: muted=true ⇒ notification='none'.
     * UI mới đọc cột này; mention-notify.ts wire `shouldNotify` qua field này.
     */
    notificationSetting: text('notification_setting').notNull().default('all'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.channelId] }),
  }),
);

/**
 * V2 G2 (2026-05-21): edit history per message.
 *
 * Mỗi lần user PUT /messages/[id], snapshot content cũ vào đây trước khi
 * update bảng chính. Frontend gọi GET /messages/[id]/history → render
 * timeline edits trong modal.
 */
export const studyGroupMessageRevision = pgTable(
  'study_group_message_revision',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    messageId: text('message_id')
      .notNull()
      .references(() => studyGroupMessage.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    editedAt: timestamp('edited_at').notNull().defaultNow(),
  },
  (t) => ({
    msgIdx: index('study_group_message_revision_msg_idx').on(
      t.messageId,
      t.editedAt,
    ),
  }),
);

// ──────────────────────────────────────────────────────────
// V2 G1 (2026-05-21) — Custom roles + per-channel permission overrides
// ──────────────────────────────────────────────────────────

/**
 * Custom role cho 1 study group — Discord-style.
 *
 * Khác với `groupRoleEnum` (OWNER/ADMIN/MODERATOR/MEMBER hierarchy cứng),
 * bảng này cho phép owner tạo role tuỳ ý với:
 *   - Tên + màu hex (render avatar ring + tint chữ)
 *   - Position trong hierarchy (cao hơn override thấp hơn)
 *   - Permission bitfield JSON (~20 permission)
 *   - Hoisted = show member group separate ở member list
 *   - Mentionable = `@role` ping được không
 *
 * Migration backward-compat:
 *   - Mỗi group tự auto-create 4 default role (OWNER/ADMIN/MODERATOR/MEMBER)
 *     match với cũ `groupRoleEnum`. Members migrate vào role tương ứng qua
 *     trigger SQL trong migration.
 *   - Helper `effectivePermissions(memberId, channelId?)` compute union từ
 *     mọi role assigned → apply channel overrides.
 */
export const studyGroupRole = pgTable(
  'study_group_role',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    groupId: text('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Hex color e.g. "#7289DA" — render avatar ring + name tint. */
    color: text('color').notNull().default('#9aa3af'),
    /** Position trong hierarchy. Cao hơn = quyền cao hơn (override khi conflict). */
    position: integer('position').notNull().default(0),
    /** Permission bitfield — JSON object: { canSendMessages: true, … }. */
    permissions: jsonb('permissions').notNull().default({}),
    /** Hoisted = show separately trong member list (Discord pattern). */
    hoisted: boolean('hoisted').notNull().default(false),
    /** Mentionable = @role có thể ping (admin+ luôn được ping role). */
    mentionable: boolean('mentionable').notNull().default(false),
    /** Default role mỗi group có: cannot delete, link to legacy enum. */
    isManaged: boolean('is_managed').notNull().default(false),
    /** Map về legacy groupRoleEnum để backward-compat (cho `can()` cũ). */
    legacyRole: text('legacy_role'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    groupPositionIdx: index('study_group_role_group_position_idx').on(
      t.groupId,
      t.position,
    ),
    groupNameUniq: uniqueIndex('study_group_role_group_name_uniq').on(
      t.groupId,
      t.name,
    ),
  }),
);

/**
 * Member ↔ role many-to-many — 1 member có thể gán nhiều custom role.
 *
 * Migration: auto-insert 1 row per member với role tương ứng `studyGroupMember.role`.
 */
export const studyGroupMemberRole = pgTable(
  'study_group_member_role',
  {
    memberId: text('member_id')
      .notNull()
      .references(() => studyGroupMember.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => studyGroupRole.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.memberId, t.roleId] }),
    roleIdx: index('study_group_member_role_role_idx').on(t.roleId),
  }),
);

/**
 * Per-channel permission override — Discord-style allow/deny/inherit.
 *
 * Target có thể là role HOẶC 1 user cụ thể. Exactly 1 phải set.
 *
 * Resolve order trong `effectivePermissions(member, channel)`:
 *   1. Start với union permissions của mọi role assigned cho member
 *   2. Apply role override (role nào cao position thắng nếu conflict)
 *   3. Apply user-specific override (override role overrides)
 *
 * 'allow' = grant; 'deny' = revoke; 'inherit' = không động tới (default).
 *
 * Use case:
 *   - Channel #announcements: deny `sendMessages` cho @everyone, allow cho @admin
 *   - Channel #moderator-only: deny `viewChannel` cho @everyone, allow cho @moderator
 */
export const studyGroupChannelPermission = pgTable(
  'study_group_channel_permission',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    channelId: text('channel_id')
      .notNull()
      .references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    /** Target = role HOẶC user. Exactly 1 phải set (check ở app layer). */
    roleId: text('role_id').references(() => studyGroupRole.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    /** JSON: { canSendMessages: 'allow' | 'deny' | 'inherit', … } */
    overrides: jsonb('overrides').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    channelRoleUniq: uniqueIndex('study_group_chperm_role_uniq')
      .on(t.channelId, t.roleId)
      .where(sql`role_id IS NOT NULL`),
    channelUserUniq: uniqueIndex('study_group_chperm_user_uniq')
      .on(t.channelId, t.userId)
      .where(sql`user_id IS NOT NULL`),
    channelIdx: index('study_group_chperm_channel_idx').on(t.channelId),
  }),
);

/**
 * Multi-invite link — thay thế `studyGroup.inviteCode` single token.
 *
 * Use case: owner tạo 3 invite khác nhau:
 *   - "promo-summer" max_uses=50, expires=2026-08-31 — share trên fanpage
 *   - "class-internal" max_uses=NULL, expires=NULL — share trong lớp
 *   - "vip" max_uses=5 — chỉ cho VIP
 *
 * Resolve: POST /api/groups/join { code } → check (uses_count < max_uses) AND (expires_at IS NULL OR expires_at > now())
 */
export const studyGroupInvite = pgTable(
  'study_group_invite',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    groupId: text('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    /** 8-char base32 random — share-friendly URL: /join?code=ABCD1234. */
    code: text('code').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** NULL = unlimited. */
    maxUses: integer('max_uses'),
    usesCount: integer('uses_count').notNull().default(0),
    /** NULL = never expires. */
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    groupIdx: index('study_group_invite_group_idx').on(t.groupId),
  }),
);

/**
 * Voice presence state — DB cache của LiveKit Cloud (source of truth).
 *
 * 1 user chỉ trong 1 voice channel cùng lúc → PK = userId.
 * Update qua LiveKit webhook participant_joined/left/trackPublished.
 *
 * Khi LiveKit webhook drop (network blip), state có thể stale → Inngest cron
 * 5 min reconcile từ LiveKit list API (V2).
 */
/**
 * Stage channel role per (user, channel) — Phase 20 V3.
 * AUDIENCE → canPublish=false trên LiveKit (mic/cam tắt cứng).
 * SPEAKER  → canPublish=true sau khi mod promote.
 * MOD/ADMIN/OWNER: dùng `study_group_member.role`, không lưu ở table này.
 *
 * `raisedAt`: timestamp khi audience giơ tay; NULL = không giơ tay; mod thấy
 * danh sách raised → click promote.
 */
export const studyGroupStageRole = pgTable(
  'study_group_stage_role',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    /** AUDIENCE | SPEAKER */
    role: text('role').notNull().default('AUDIENCE'),
    /** Timestamp khi user raise hand. NULL = không giơ tay. */
    raisedAt: timestamp('raised_at'),
    /** Khi mod promote → set; mod demote → clear (về AUDIENCE). */
    promotedAt: timestamp('promoted_at'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.channelId] }),
    channelIdx: index('study_group_stage_role_channel_idx').on(t.channelId, t.role),
  }),
);

export const studyGroupVoiceState = pgTable(
  'study_group_voice_state',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    /** Self-muted (mic off bởi user) — sync từ LiveKit metadata. */
    selfMuted: boolean('self_muted').notNull().default(false),
    /** Server-muted bởi moderator — kéo mute trên LiveKit room. */
    serverMuted: boolean('server_muted').notNull().default(false),
    camera: boolean('camera').notNull().default(false),
    screenShare: boolean('screen_share').notNull().default(false),
  },
  (t) => ({
    channelIdx: index('study_group_voice_state_channel_idx').on(t.channelId),
  }),
);

// ──────────────────────────────────────────────────────────
// Domain — Study Rooms (Phase 13)
// ──────────────────────────────────────────────────────────
/**
 * Room = 1 phòng học/làm việc nhóm realtime.
 *
 * Field chính:
 *   - `joinCode`: 6-char random base32, share qua link `/rooms/join/{code}`.
 *     UNLISTED/PUBLIC: ai có code đều join. PRIVATE: phải là member ACTIVE.
 *   - `livekitRoomName`: tên room ở phía LiveKit SFU. Convention = id (text)
 *     để khớp 1-1, dễ debug. Cột riêng phòng trường hợp sau này tách logic
 *     room ↔ livekit (vd 1 logical room map vào 2 livekit room song song).
 *   - `features`: JSONB toggle bật/tắt chat/whiteboard/notes/aiTutor/...
 *     Default mở hết trừ recording (cần consent).
 *   - `requireApproval`: nếu TRUE, user khác phải được mod approve mới join.
 *   - `scheduledStart` + `recurringPattern`: Phase 13.8 (cron auto-start
 *     + clone occurrence kế tiếp cho recurring).
 *
 * Status lifecycle:
 *   IDLE → ACTIVE (LiveKit webhook room_started) → ENDED (room_finished).
 */
export const room = pgTable(
  'room',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    type: roomTypeEnum('type').notNull().default('STUDY'),
    visibility: roomVisibilityEnum('visibility').notNull().default('PRIVATE'),
    joinCode: text('join_code').unique(),
    maxMembers: integer('max_members').notNull().default(10),
    requireApproval: boolean('require_approval').notNull().default(false),
    /**
     * Toggle feature theo room. Default mở chat/notes/AI; recording off
     * vì cần explicit consent + R2 setup.
     */
    features: jsonb('features').notNull().default({
      video: true,
      chat: true,
      whiteboard: true,
      notes: true,
      aiTutor: true,
      pomodoro: true,
      recording: false,
    }),
    livekitRoomName: text('livekit_room_name'),
    scheduledStart: timestamp('scheduled_start'),
    scheduledEnd: timestamp('scheduled_end'),
    /** {freq: 'WEEKLY'|'DAILY', days: number[], until?: string ISO} — Phase 13.8 */
    recurringPattern: jsonb('recurring_pattern'),
    status: roomStatusEnum('status').notNull().default('IDLE'),
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('room_owner_idx').on(t.ownerId),
    joinCodeIdx: index('room_join_code_idx').on(t.joinCode),
    statusIdx: index('room_status_idx').on(t.status),
    scheduledIdx: index('room_scheduled_idx').on(t.scheduledStart),
  }),
);

/**
 * Membership của user trong room. Unique (roomId, userId).
 *
 * Status flow:
 *   PENDING → (mod approve) → ACTIVE
 *           ↘ (mod reject)  → BANNED
 *   ACTIVE  → (mod kick)    → KICKED  (có thể unban sau)
 *           → (mod ban)     → BANNED  (permanent)
 */
export const roomMember = pgTable(
  'room_member',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    roomId: text('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: roomMemberRoleEnum('role').notNull().default('MEMBER'),
    status: roomMemberStatusEnum('status').notNull().default('ACTIVE'),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at'),
  },
  (t) => ({
    uniq: uniqueIndex('room_member_uniq').on(t.roomId, t.userId),
    userIdx: index('room_member_user_idx').on(t.userId),
    statusIdx: index('room_member_status_idx').on(t.roomId, t.status),
  }),
);

/**
 * Lịch sử chat trong room (text/file/AI/system).
 *
 * `userId` = 'AI_TUTOR' cho AI message (Phase 15). KHÔNG FK để tránh
 * cascade phức tạp khi AI message stay sau khi user xoá account.
 * Filter `userId !== 'AI_TUTOR'` khi cần join với user table.
 */
export const roomMessage = pgTable(
  'room_message',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    roomId: text('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    content: text('content').notNull(),
    /** TEXT | FILE | SYSTEM | AI | POLL — string thường, không enum vì add type mới hay */
    type: text('type').notNull().default('TEXT'),
    metadata: jsonb('metadata'),
    replyToId: text('reply_to_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    roomTimeIdx: index('room_message_room_time_idx').on(t.roomId, t.createdAt),
  }),
);

/**
 * Audit log sự kiện trong room (JOINED, LEFT, SCREEN_SHARE_STARTED, ...).
 * Phục vụ analytics + replay timeline cho recording (Phase 15).
 * LiveKit webhook (Phase 13.4) ghi vào đây.
 */
export const roomEvent = pgTable(
  'room_event',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    roomId: text('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    type: text('type').notNull(),
    metadata: jsonb('metadata'),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
  },
  (t) => ({
    roomTimeIdx: index('room_event_room_time_idx').on(t.roomId, t.timestamp),
  }),
);

/**
 * Recording metadata (Phase 15 sẽ wire egress + transcribe).
 * Schema sẵn từ Phase 13 để migration không phải breaking change sau.
 */
export const recording = pgTable(
  'recording',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    /**
     * Owner #1: standalone room (Phase 13/15). Nullable từ V3 vì recording có
     * thể thuộc về study group voice channel thay vì room.
     */
    roomId: text('room_id').references(() => room.id, { onDelete: 'cascade' }),
    /**
     * Owner #2 (V3): voice channel của study group. NULL nếu là room recording.
     * DB constraint `recording_owner_xor` enforce đúng 1 trong 2 cột có giá trị.
     */
    studyGroupChannelId: text('study_group_channel_id').references(
      () => studyGroupChannel.id,
      { onDelete: 'cascade' },
    ),
    /** User trigger record — NULL nếu account đã xoá. */
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    egressId: text('egress_id').unique(),
    /**
     * R2 object key (path trong bucket) — set ngay khi start egress vì LiveKit
     * không reliable trả về filename trong webhook/listEgress (V3 fix).
     * Format: `recordings/group/{channelId}/{ts}.mp4` hoặc `recordings/{roomId}/{ts}.mp4`.
     * Public URL = `${R2_PUBLIC_URL}/${storageKey}`.
     */
    storageKey: text('storage_key'),
    fileUrl: text('file_url'),
    duration: integer('duration_seconds'),
    fileSize: integer('file_size_bytes'),
    /** RECORDING | PROCESSING | PROCESSED | FAILED */
    status: text('status').notNull().default('RECORDING'),
    transcript: text('transcript'),
    summary: text('summary'),
    chapters: jsonb('chapters'),
    highlights: jsonb('highlights'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    endedAt: timestamp('ended_at'),
  },
  (t) => ({
    roomIdx: index('recording_room_idx').on(t.roomId),
    channelIdx: index('recording_channel_idx').on(t.studyGroupChannelId, t.startedAt),
  }),
);

/**
 * Yjs binary state cho whiteboard/notes/code editor (Phase 14).
 * - `id` format: `room:{roomId}:whiteboard` / `room:{roomId}:notes`.
 * - `state`: base64 encode binary từ Yjs `encodeStateAsUpdate(doc)`.
 * - Hocuspocus server fetch/store qua bảng này.
 *
 * Không reference room.id qua FK vì Hocuspocus chạy service riêng và auth
 * theo JWT, không qua Drizzle. Cascade khi xoá room qua Inngest job.
 */
export const collabDoc = pgTable('collab_doc', {
  id: text('id').primaryKey(),
  /** WHITEBOARD | NOTES | CODE */
  type: text('type').notNull(),
  state: text('state').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────
// Audit log (Plan v2 §15.1 W9-10 / §10.8 — compliance + security)
// ──────────────────────────────────────────────────────────
/**
 * Audit log — immutable record của mọi action security/compliance-relevant.
 *
 * Use cases:
 *   - Authentication events (login, logout, failed attempts)
 *   - PII access (who saw whose data)
 *   - Admin actions (role change, user delete)
 *   - GDPR actions (export, deletion)
 *   - Security events (rate limit hit, suspicious geo)
 *   - Financial events (payment, refund, plan upgrade)
 *
 * Retention 7 năm (FERPA + SOC2 minimum). Phân vùng theo tháng (xem
 * partition runbook 0003_partition_runbook.md) khi > 50M row.
 *
 * KHÔNG có UPDATE/DELETE từ app — chỉ INSERT. Enforce qua DB trigger ở
 * migration nếu cần strict.
 *
 * actor_type:
 *   - 'user' (action do end-user thực hiện)
 *   - 'system' (cron, Inngest job, scheduled task)
 *   - 'admin' (Cogniva staff support)
 *   - 'webhook' (LiveKit, Stripe, etc.)
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    /** Ai thực hiện. NULL nếu anonymous (vd failed login trước khi biết user). */
    actorId: text('actor_id'),
    /** 'user' | 'system' | 'admin' | 'webhook' */
    actorType: text('actor_type').notNull(),
    /** Action format `{domain}.{verb}` — vd 'auth.login', 'gdpr.export.requested'. */
    action: text('action').notNull(),
    /** 'success' | 'denied' | 'error' */
    result: text('result').notNull(),
    /** Loại tài nguyên bị tác động ('user', 'document', 'flashcard', ...). NULL cho event không gắn resource. */
    resourceType: text('resource_type'),
    /** ID tài nguyên. */
    resourceId: text('resource_id'),
    /** IP của requester (anonymized last octet cho EU PII compliance nếu cần). */
    ipAddress: text('ip_address'),
    /** User-Agent string (trim < 500 char). */
    userAgent: text('user_agent'),
    /** Trace ID từ middleware — correlate với Sentry, log. */
    traceId: text('trace_id'),
    /** Metadata bổ sung (action-specific). */
    metadata: jsonb('metadata'),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
  },
  (t) => ({
    actorTimeIdx: index('audit_log_actor_time_idx').on(t.actorId, t.timestamp),
    actionTimeIdx: index('audit_log_action_time_idx').on(t.action, t.timestamp),
    resourceIdx: index('audit_log_resource_idx').on(t.resourceType, t.resourceId),
  }),
);

// ──────────────────────────────────────────────────────────
// GDPR — deletion grace queue
// ──────────────────────────────────────────────────────────
/**
 * Deletion request — user yêu cầu xoá account → soft delete 30 ngày grace
 * trước khi hard delete data.
 *
 * Status flow:
 *   PENDING (user request) → CANCELLED (user undo trong 30d)
 *                          ↘ PROCESSING (Inngest job picked up)
 *                          ↘ COMPLETED (hard delete done)
 *                          ↘ FAILED (job error, retry manual)
 *
 * Cố ý KHÔNG FK tới user — sau khi user.id xoá, vẫn giữ record cho audit.
 */
export const deletionRequest = pgTable('deletion_request', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull(),
  /** 'PENDING' | 'CANCELLED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' */
  status: text('status').notNull().default('PENDING'),
  /** Lý do user nêu (optional). */
  reason: text('reason'),
  /** Khi hard delete sẽ chạy (request + 30 ngày). */
  scheduledFor: timestamp('scheduled_for').notNull(),
  /** Khi job thực sự complete. */
  completedAt: timestamp('completed_at'),
  /** Error message nếu FAILED. */
  errorMessage: text('error_message'),
  requestedAt: timestamp('requested_at').notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────
// Push notification token (Stage 2 M7 — mobile push delivery)
// ──────────────────────────────────────────────────────────
/**
 * Push notification token — lưu Expo Push Token / FCM / APNs token cho từng
 * thiết bị của user. Backend Inngest worker query bảng này để gửi notif qua
 * Expo Push API (`https://exp.host/--/api/v2/push/send`).
 *
 * Mỗi user có thể có NHIỀU token (multi-device: phone + tablet + web push).
 * Token unique trên toàn hệ thống — nếu cùng token đã đăng ký bởi user khác
 * (case rất hiếm: user A bán phone cho user B, B sign-in lại) → upsert
 * theo `token` (unique) thay vì `(userId, token)`.
 *
 * Cleanup strategy:
 *   - Cron daily xoá token có `lastSeenAt` > 90 ngày (device không mở app)
 *   - Expo Push API trả `DeviceNotRegistered` → xoá ngay (token revoked)
 */
export const pushToken = pgTable(
  'push_token',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Expo format `ExponentPushToken[xxx]`. Unique để dedupe khi user reinstall app. */
    token: text('token').notNull().unique(),
    /** 'ios' | 'android' | 'web' */
    platform: text('platform').notNull(),
    /** Identifier device (nếu có) — phân biệt iPhone vs iPad cùng user. */
    deviceId: text('device_id'),
    /** Đánh dấu disabled tạm thời (user opt-out, nhưng giữ row cho audit). */
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    /** Update mỗi lần app khởi động + register lại → biết token còn active. */
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  },
  (t) => ({
    // Query "all tokens of user X" cho Inngest worker — index quan trọng
    userIdx: index('push_token_user_idx').on(t.userId),
    // Lookup theo token để upsert + verify ownership trên DELETE endpoint
    tokenIdx: uniqueIndex('push_token_token_idx').on(t.token),
  }),
);

/**
 * Notification log — audit trail cho notif đã gửi. Phục vụ:
 *   - Dedupe: không gửi 2 lần cùng FSRS reminder trong 24h
 *   - Analytics: open rate, click-through (mobile chưa wire click webhook)
 *   - Compliance: GDPR — user yêu cầu export notif đã nhận
 *
 * Retention 90 ngày — sau đó cron xoá để giảm size. KHÔNG critical data nên
 * không cần audit_log-grade retention.
 */
export const notificationLog = pgTable(
  'notification_log',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Type khớp payload `data.type` mà mobile client switch để deep link.
     *  'flashcard-due' | 'room-invite' | 'document-ready' | 'streak-warning' */
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Deep link payload (cardId, roomId, …) — JSON gửi kèm push notification. */
    data: jsonb('data'),
    /** 'pending' | 'sent' | 'failed' | 'rejected' (DeviceNotRegistered) */
    status: text('status').notNull().default('pending'),
    /** Expo Push API receipt id (để query delivery status sau). */
    receiptId: text('receipt_id'),
    /** Error message từ Expo Push API nếu failed. */
    error: text('error'),
    sentAt: timestamp('sent_at'),
    /**
     * Phase 2 follow — user đã xem chưa (NotificationBell mark read).
     * NULL = chưa xem → tính badge unread count.
     */
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // Dedupe query: SELECT WHERE userId + type + createdAt > now() - 24h
    userTypeIdx: index('notification_log_user_type_idx').on(t.userId, t.type, t.createdAt),
  }),
);

// ──────────────────────────────────────────────────────────
// Exam System (Phase 16) — exam, examQuestion, examAttempt, examResponse, examViolation
// ──────────────────────────────────────────────────────────
/**
 * Bảng `exam` — bài kiểm tra do teacher/user tạo.
 *
 * Khác với `quiz` (Phase 6 V1):
 *   - quiz: AI sinh từ concept đơn, free-form, không có lifecycle phức tạp
 *   - exam: có lifecycle DRAFT → PUBLISHED → IN_PROGRESS → ENDED, hỗ trợ
 *     nhiều mode (Practice / Timed / Live / Adaptive), anti-cheat config
 *
 * Schema có sẵn cột cho Phase 17 (Live) + Phase 18 (Adaptive) để migration
 * sau không phải breaking:
 *   - Live: `liveCode` UNIQUE, `currentQuestionIndex` (broadcast tới students)
 *   - Adaptive: `minQuestions/maxQuestions/targetSE` (IRT termination criteria)
 *   - Anti-cheat: jsonb config block, evaluated client-side
 */
export const examModeEnum = pgEnum('exam_mode', [
  'PRACTICE',   // không giới hạn thời gian, show explanation ngay
  'TIMED',      // countdown global, auto-submit khi hết giờ
  'LIVE',       // Phase 17 — Kahoot style, teacher điều khiển
  'ASYNC',      // open trong khoảng thời gian, mỗi student có timer riêng
  'ADAPTIVE',   // Phase 18 — IRT/CAT, độ khó adapt theo theta
  'TOURNAMENT', // V4 — bracket competitive
]);

export const examStatusEnum = pgEnum('exam_status', [
  'DRAFT',       // owner đang soạn, student chưa thấy
  'PUBLISHED',   // student có thể start attempt
  'IN_PROGRESS', // Live mode đang chạy
  'ENDED',       // đã đóng, chỉ xem result được
]);

export const attemptStatusEnum = pgEnum('attempt_status', [
  'IN_PROGRESS',    // student đang làm
  'SUBMITTED',      // student bấm Submit chủ động
  'TIMED_OUT',      // hết thời gian, auto-submit
  'AUTO_SUBMITTED', // backend cron submit (vd page reload mất state)
  'DISQUALIFIED',   // bị anti-cheat flag + owner reject
]);

export const exam = pgTable(
  'exam',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * Workspace chứa exam (Phase Workspace-centric).
     * Nullable — exam có thể "global". Workspace xoá → set null.
     */
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    mode: examModeEnum('mode').notNull().default('PRACTICE'),
    status: examStatusEnum('status').notNull().default('DRAFT'),

    /** Timer cho TIMED/LIVE mode (giây). NULL nghĩa unlimited (PRACTICE). */
    durationSeconds: integer('duration_seconds'),
    /** ASYNC mode — exam available trong window. NULL = bất kỳ lúc nào. */
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),

    /** Ngưỡng điểm pass (0..1). NULL = không có pass/fail concept. */
    passingScore: real('passing_score'),
    /** Tổng điểm tối đa (sum points của examQuestion). Cache để tránh aggregate. */
    maxScore: real('max_score').notNull().default(0),
    /** Khi nào hiện result: IMMEDIATE (xong câu show ngay), AFTER_SUBMIT, AFTER_ALL_DONE (teacher unlock). */
    showResults: text('show_results').notNull().default('IMMEDIATE'),

    shuffleQuestions: boolean('shuffle_questions').notNull().default(true),
    shuffleOptions: boolean('shuffle_options').notNull().default(true),
    allowReview: boolean('allow_review').notNull().default(true),
    maxAttempts: integer('max_attempts').notNull().default(1),

    // ── Live (Phase 17 sẽ wire fully) ──────────────────────
    /** Code 6 ký tự cho student join LIVE exam (Kahoot style). UNIQUE để dedupe. */
    liveCode: text('live_code').unique(),
    /** Index câu đang broadcast cho students trong LIVE mode. */
    currentQuestionIndex: integer('current_question_index'),

    // ── Adaptive (Phase 18) ─────────────────────────────────
    minQuestions: integer('min_questions').default(10),
    maxQuestions: integer('max_questions').default(30),
    /** Target standard error of theta — termination criterion IRT. */
    targetSE: real('target_se').default(0.3),

    // ── Anti-cheat config (Phase 19 wire fully) ─────────────
    /** JSONB config: { requireFullscreen, blockTabSwitch, blockCopyPaste, blockContextMenu, detectDevtools, requireWebcam, requireMic, aiProctor } */
    antiCheat: jsonb('anti_cheat').$type<{
      requireFullscreen?: boolean;
      blockTabSwitch?: boolean;
      blockCopyPaste?: boolean;
      blockContextMenu?: boolean;
      detectDevtools?: boolean;
      requireWebcam?: boolean;
      requireMic?: boolean;
      aiProctor?: boolean;
    }>().default({}),

    /** Liên kết classroom (V4 — Phase 9 social) nếu exam thuộc lớp học. */
    classroomId: text('classroom_id'),
    /** Concept tag để analytics + adaptive engine biết exam test gì. */
    conceptIds: jsonb('concept_ids').$type<string[]>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    publishedAt: timestamp('published_at'),
  },
  (t) => ({
    ownerStatusIdx: index('exam_owner_status_idx').on(t.ownerId, t.status),
    liveCodeIdx: uniqueIndex('exam_live_code_idx').on(t.liveCode),
    ownerWorkspaceIdx: index('exam_owner_workspace_idx').on(t.ownerId, t.workspaceId),
  }),
);

/**
 * Bảng `exam_question` — câu hỏi trong exam.
 *
 * Tên dài để rõ ràng không lẫn `question` (Phase 6 quiz). Sống song song với
 * `question` trong thời gian dài, eventual deprecation khi quiz V1 migrate.
 *
 * `type` dùng plain text (không enum) để dễ thêm loại mới mà không cần
 * migration ALTER TYPE. Validate ở app layer. Giá trị hiện tại:
 *   MCQ_SINGLE | MCQ_MULTI | TRUE_FALSE | SHORT | ESSAY | FILL_BLANK |
 *   MATCHING | ORDERING | CODE | MATH | DRAWING
 *
 * `correctAnswer` jsonb format theo type:
 *   - MCQ_SINGLE: number (index của correct option)
 *   - MCQ_MULTI: number[] (mảng index)
 *   - TRUE_FALSE: boolean
 *   - SHORT/FILL_BLANK: string (canonical) + acceptableAnswers (alt)
 *   - ORDERING: string[] (đúng thứ tự)
 *   - MATCHING: { [leftKey: string]: string } (right value)
 *   - ESSAY: null (graded bằng AI/manual qua rubric)
 */
export const examQuestion = pgTable(
  'exam_question',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    examId: text('exam_id')
      .notNull()
      .references(() => exam.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),

    prompt: text('prompt').notNull(),
    /** Render HTML/markdown cho math + code blocks. NULL = plain text. */
    promptHtml: text('prompt_html'),
    /** [{ type: 'image'|'audio'|'video', url, alt? }] */
    attachments: jsonb('attachments').$type<Array<{ type: string; url: string; alt?: string }>>(),

    /** Lựa chọn cho MCQ/MATCHING. NULL với type khác. */
    options: jsonb('options').$type<string[] | Record<string, string> | null>(),
    correctAnswer: jsonb('correct_answer'),
    /** Mảng đáp án thay thế chấp nhận (FILL_BLANK, SHORT) — case-insensitive match. */
    acceptableAnswers: jsonb('acceptable_answers').$type<string[] | null>(),
    /** Rubric ESSAY: [{ criterion, weight, descriptors: {excellent, good, needs_work} }] */
    rubric: jsonb('rubric'),
    /** Phase 18 — test cases cho CODE type. */
    testCases: jsonb('test_cases'),

    points: real('points').notNull().default(1),
    partialCredit: boolean('partial_credit').notNull().default(false),

    // ── IRT (Phase 18) ──────────────────────────────────────
    difficulty: real('difficulty').notNull().default(0),
    discrimination: real('discrimination').notNull().default(1),
    /** Pseudo-guessing parameter (3PL IRT). */
    guessing: real('guessing').notNull().default(0),

    /** Concept liên kết — analytics + adaptive item selection. */
    conceptId: text('concept_id').references(() => concept.id, { onDelete: 'set null' }),
    explanation: text('explanation'),
    hint: text('hint'),
    /** Per-question timer (giây) — Phase 17 Kahoot mode. NULL = không giới hạn riêng. */
    timeLimitSeconds: integer('time_limit_seconds'),
    /** Thứ tự câu trong exam (1-indexed). Owner reorder qua drag-drop. */
    orderIndex: integer('order_index').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // Query "all questions của exam X theo order" — hot path
    examOrderIdx: index('exam_question_exam_order_idx').on(t.examId, t.orderIndex),
  }),
);

/**
 * Bảng `exam_attempt` — 1 phiên làm exam của user.
 *
 * 1 user có thể có nhiều attempt cùng 1 exam (nếu `exam.maxAttempts > 1`).
 * Pre-check ở API: count attempts trước khi insert mới.
 *
 * Lifecycle:
 *   IN_PROGRESS → SUBMITTED (user bấm Submit)
 *   IN_PROGRESS → TIMED_OUT (cron khi quá durationSeconds)
 *   IN_PROGRESS → AUTO_SUBMITTED (backend force-close khi student vắng)
 *   * → DISQUALIFIED (anti-cheat flag + owner manual)
 */
export const examAttempt = pgTable(
  'exam_attempt',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    examId: text('exam_id')
      .notNull()
      .references(() => exam.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: attemptStatusEnum('status').notNull().default('IN_PROGRESS'),

    startedAt: timestamp('started_at').notNull().defaultNow(),
    submittedAt: timestamp('submitted_at'),

    /** Tổng điểm đã đạt (sum pointsEarned). NULL khi chưa grade xong. */
    score: real('score'),
    maxScore: real('max_score'),
    /** % = score/maxScore. Cache để leaderboard query nhanh không phải divide. */
    percentage: real('percentage'),
    passed: boolean('passed'),

    // ── Adaptive (Phase 18) ─────────────────────────────────
    estimatedTheta: real('estimated_theta'),
    thetaSE: real('theta_se'),

    /** Tổng thời gian làm bài (s). Tính khi submit. */
    timeSpentSeconds: integer('time_spent_seconds'),
    questionsAnswered: integer('questions_answered').notNull().default(0),

    // ── Anti-cheat (Phase 19 fully wire) ────────────────────
    /** [{ type: 'tab_switch'|'paste'|'fullscreen_exit', timestamp, metadata? }] */
    violations: jsonb('violations').$type<Array<{ type: string; timestamp: string; metadata?: unknown }>>(),
    /** 0..1 — AI cheat detection score (Phase 19). */
    cheatRiskScore: real('cheat_risk_score'),
    flagged: boolean('flagged').notNull().default(false),
    flagReason: text('flag_reason'),

    /** Webcam recording URL (R2 key) nếu requireWebcam. */
    webcamRecordingUrl: text('webcam_recording_url'),
    /** Note manual của teacher review. */
    proctorNotes: text('proctor_notes'),

    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    browserFingerprint: text('browser_fingerprint'),
  },
  (t) => ({
    examUserIdx: index('exam_attempt_exam_user_idx').on(t.examId, t.userId),
    userStatusIdx: index('exam_attempt_user_status_idx').on(t.userId, t.status),
  }),
);

/**
 * Bảng `exam_response` — câu trả lời của user cho 1 câu hỏi cụ thể.
 *
 * Auto-save: client POST response mỗi khi user trả lời/đổi đáp án →
 * upsert theo (attemptId, questionId). Khi attempt SUBMITTED, grade lại tất cả.
 *
 * `answer` jsonb format theo questionType (xem comment ở exam_question).
 */
export const examResponse = pgTable(
  'exam_response',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => examAttempt.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => examQuestion.id, { onDelete: 'cascade' }),
    answer: jsonb('answer'),
    isCorrect: boolean('is_correct'),
    pointsEarned: real('points_earned').notNull().default(0),

    startedAt: timestamp('started_at'),
    submittedAt: timestamp('submitted_at'),
    /** Thời gian từ khi câu hiện ra đến khi submit (ms). Phase 18 analytics. */
    responseTimeMs: integer('response_time_ms'),
    /** Phase 17 — rank lúc submit (Kahoot scoring time-bonus). */
    rankAtSubmit: integer('rank_at_submit'),

    // ── AI/manual grading (cho ESSAY/SHORT) ──────────────────
    /** { score, feedback, breakdown: {criterion: score} } */
    aiGrading: jsonb('ai_grading'),
    /** Teacher override hoặc bổ sung. Cùng shape với aiGrading. */
    manualGrading: jsonb('manual_grading'),
    needsReview: boolean('needs_review').notNull().default(false),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // Upsert key (attemptId, questionId) — 1 response per question per attempt
    attemptQuestionIdx: uniqueIndex('exam_response_attempt_question_idx').on(t.attemptId, t.questionId),
  }),
);

/**
 * Bảng `exam_violation` — log từng sự kiện vi phạm trong exam.
 *
 * Phase 16 chỉ insert log; Phase 19 sẽ:
 *   - Aggregate violations → cheatRiskScore
 *   - AI proctor (webcam frame analysis) ghi log type='ai_suspicious'
 *   - Auto-flag attempt khi cheatRiskScore > threshold
 *
 * Type ví dụ: 'tab_switch', 'paste', 'copy', 'fullscreen_exit', 'devtools',
 * 'multiple_faces', 'no_face', 'looking_away', 'phone_detected'.
 *
 * Severity: 'low' (warn UI), 'medium' (log + notify proctor), 'high' (auto-flag).
 */
export const examViolation = pgTable(
  'exam_violation',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => examAttempt.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    /** 'low' | 'medium' | 'high' */
    severity: text('severity').notNull(),
    metadata: jsonb('metadata'),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
  },
  (t) => ({
    attemptIdx: index('exam_violation_attempt_idx').on(t.attemptId),
  }),
);

// ──────────────────────────────────────────────────────────
// Relations — khai báo cho Drizzle để hỗ trợ join type-safe
// ──────────────────────────────────────────────────────────
// `relations()` không tạo cột mới — chỉ là metadata để Drizzle suy luận
// kiểu trả về khi dùng `db.query.user.findMany({ with: { workspaces: true } })`.
export const userRelations = relations(user, ({ many }) => ({
  workspaces: many(workspace),
  documents: many(document),
  conversations: many(conversation),
  flashcards: many(flashcard),
  mastery: many(mastery),
  studySessions: many(studySession),
  sessions: many(session),
  accounts: many(account),
  pushTokens: many(pushToken),
  notificationLogs: many(notificationLog),
}));

export const pushTokenRelations = relations(pushToken, ({ one }) => ({
  user: one(user, { fields: [pushToken.userId], references: [user.id] }),
}));

export const notificationLogRelations = relations(notificationLog, ({ one }) => ({
  user: one(user, { fields: [notificationLog.userId], references: [user.id] }),
}));

// ── Phase 16 Exam System ──────────────────────────────────
export const examRelations = relations(exam, ({ one, many }) => ({
  owner: one(user, { fields: [exam.ownerId], references: [user.id] }),
  workspace: one(workspace, { fields: [exam.workspaceId], references: [workspace.id] }),
  questions: many(examQuestion),
  attempts: many(examAttempt),
}));

export const examQuestionRelations = relations(examQuestion, ({ one, many }) => ({
  exam: one(exam, { fields: [examQuestion.examId], references: [exam.id] }),
  concept: one(concept, { fields: [examQuestion.conceptId], references: [concept.id] }),
  responses: many(examResponse),
}));

export const examAttemptRelations = relations(examAttempt, ({ one, many }) => ({
  exam: one(exam, { fields: [examAttempt.examId], references: [exam.id] }),
  user: one(user, { fields: [examAttempt.userId], references: [user.id] }),
  responses: many(examResponse),
  violations: many(examViolation),
}));

export const examResponseRelations = relations(examResponse, ({ one }) => ({
  attempt: one(examAttempt, { fields: [examResponse.attemptId], references: [examAttempt.id] }),
  question: one(examQuestion, { fields: [examResponse.questionId], references: [examQuestion.id] }),
  reviewer: one(user, { fields: [examResponse.reviewedBy], references: [user.id] }),
}));

export const examViolationRelations = relations(examViolation, ({ one }) => ({
  attempt: one(examAttempt, { fields: [examViolation.attemptId], references: [examAttempt.id] }),
}));


export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const workspaceRelations = relations(workspace, ({ one, many }) => ({
  user: one(user, { fields: [workspace.userId], references: [user.id] }),
  documents: many(document),
  notes: many(note),
  flashcards: many(flashcard),
  quizzes: many(quiz),
  exams: many(exam),
}));

export const documentRelations = relations(document, ({ one, many }) => ({
  user: one(user, { fields: [document.userId], references: [user.id] }),
  workspace: one(workspace, { fields: [document.workspaceId], references: [workspace.id] }),
  chunks: many(chunk),
}));

export const chunkRelations = relations(chunk, ({ one, many }) => ({
  document: one(document, { fields: [chunk.documentId], references: [document.id] }),
  chunkConcepts: many(chunkConcept),
}));

export const chunkConceptRelations = relations(chunkConcept, ({ one }) => ({
  chunk: one(chunk, { fields: [chunkConcept.chunkId], references: [chunk.id] }),
  concept: one(concept, { fields: [chunkConcept.conceptId], references: [concept.id] }),
}));

// concept có 2 quan hệ self-reference (outgoing/incoming) qua bảng concept_relation
// → phải đặt relationName để Drizzle phân biệt được 2 chiều.
export const conceptRelations = relations(concept, ({ many }) => ({
  outgoing: many(conceptRelation, { relationName: 'concept_outgoing' }),
  incoming: many(conceptRelation, { relationName: 'concept_incoming' }),
  flashcards: many(flashcard),
  mastery: many(mastery),
  chunkConcepts: many(chunkConcept),
}));

export const conceptRelationRelations = relations(conceptRelation, ({ one }) => ({
  from: one(concept, {
    fields: [conceptRelation.fromId],
    references: [concept.id],
    relationName: 'concept_outgoing',
  }),
  to: one(concept, {
    fields: [conceptRelation.toId],
    references: [concept.id],
    relationName: 'concept_incoming',
  }),
}));

export const masteryRelations = relations(mastery, ({ one }) => ({
  user: one(user, { fields: [mastery.userId], references: [user.id] }),
  concept: one(concept, { fields: [mastery.conceptId], references: [concept.id] }),
}));

export const conversationRelations = relations(conversation, ({ one, many }) => ({
  user: one(user, { fields: [conversation.userId], references: [user.id] }),
  workspace: one(workspace, {
    fields: [conversation.workspaceId],
    references: [workspace.id],
  }),
  messages: many(message),
}));

export const messageRelations = relations(message, ({ one }) => ({
  conversation: one(conversation, {
    fields: [message.conversationId],
    references: [conversation.id],
  }),
}));

export const flashcardRelations = relations(flashcard, ({ one, many }) => ({
  user: one(user, { fields: [flashcard.userId], references: [user.id] }),
  workspace: one(workspace, { fields: [flashcard.workspaceId], references: [workspace.id] }),
  concept: one(concept, { fields: [flashcard.conceptId], references: [concept.id] }),
  sourceChunk: one(chunk, { fields: [flashcard.sourceChunkId], references: [chunk.id] }),
  reviews: many(review),
}));

export const reviewRelations = relations(review, ({ one }) => ({
  flashcard: one(flashcard, { fields: [review.flashcardId], references: [flashcard.id] }),
}));

export const quizRelations = relations(quiz, ({ one, many }) => ({
  user: one(user, { fields: [quiz.userId], references: [user.id] }),
  workspace: one(workspace, { fields: [quiz.workspaceId], references: [workspace.id] }),
  questions: many(question),
}));

export const questionRelations = relations(question, ({ one }) => ({
  quiz: one(quiz, { fields: [question.quizId], references: [quiz.id] }),
  concept: one(concept, { fields: [question.conceptId], references: [concept.id] }),
}));

export const studySessionRelations = relations(studySession, ({ one }) => ({
  user: one(user, { fields: [studySession.userId], references: [user.id] }),
}));

export const roomRelations = relations(room, ({ one, many }) => ({
  owner: one(user, { fields: [room.ownerId], references: [user.id] }),
  members: many(roomMember),
  messages: many(roomMessage),
  events: many(roomEvent),
  recordings: many(recording),
}));

export const roomMemberRelations = relations(roomMember, ({ one }) => ({
  room: one(room, { fields: [roomMember.roomId], references: [room.id] }),
  user: one(user, { fields: [roomMember.userId], references: [user.id] }),
}));

export const roomMessageRelations = relations(roomMessage, ({ one }) => ({
  room: one(room, { fields: [roomMessage.roomId], references: [room.id] }),
}));

export const roomEventRelations = relations(roomEvent, ({ one }) => ({
  room: one(room, { fields: [roomEvent.roomId], references: [room.id] }),
}));

export const recordingRelations = relations(recording, ({ one }) => ({
  room: one(room, { fields: [recording.roomId], references: [room.id] }),
  channel: one(studyGroupChannel, {
    fields: [recording.studyGroupChannelId],
    references: [studyGroupChannel.id],
  }),
}));

// ── Phase 20 — Study Group Channels ───────────────────────
export const studyGroupRelations = relations(studyGroup, ({ one, many }) => ({
  owner: one(user, { fields: [studyGroup.ownerUserId], references: [user.id] }),
  members: many(studyGroupMember),
  channels: many(studyGroupChannel),
  invites: many(studyGroupInvite),
}));

export const studyGroupMemberRelations = relations(studyGroupMember, ({ one }) => ({
  group: one(studyGroup, { fields: [studyGroupMember.groupId], references: [studyGroup.id] }),
  user: one(user, { fields: [studyGroupMember.userId], references: [user.id] }),
}));

export const studyGroupChannelRelations = relations(studyGroupChannel, ({ one, many }) => ({
  group: one(studyGroup, { fields: [studyGroupChannel.groupId], references: [studyGroup.id] }),
  creator: one(user, { fields: [studyGroupChannel.createdBy], references: [user.id] }),
  messages: many(studyGroupMessage),
  voiceStates: many(studyGroupVoiceState),
}));

export const studyGroupMessageRelations = relations(studyGroupMessage, ({ one }) => ({
  channel: one(studyGroupChannel, {
    fields: [studyGroupMessage.channelId],
    references: [studyGroupChannel.id],
  }),
  author: one(user, { fields: [studyGroupMessage.authorId], references: [user.id] }),
}));

export const studyGroupInviteRelations = relations(studyGroupInvite, ({ one }) => ({
  group: one(studyGroup, { fields: [studyGroupInvite.groupId], references: [studyGroup.id] }),
  creator: one(user, { fields: [studyGroupInvite.createdBy], references: [user.id] }),
}));

export const studyGroupReadStateRelations = relations(studyGroupReadState, ({ one }) => ({
  user: one(user, { fields: [studyGroupReadState.userId], references: [user.id] }),
  channel: one(studyGroupChannel, {
    fields: [studyGroupReadState.channelId],
    references: [studyGroupChannel.id],
  }),
}));

export const studyGroupVoiceStateRelations = relations(studyGroupVoiceState, ({ one }) => ({
  user: one(user, { fields: [studyGroupVoiceState.userId], references: [user.id] }),
  channel: one(studyGroupChannel, {
    fields: [studyGroupVoiceState.channelId],
    references: [studyGroupChannel.id],
  }),
}));

// ══════════════════════════════════════════════════════════
// PHASE 21 — TUTORING MARKETPLACE (V1)
// 5 bảng: profile / subject / availability / request / application
// Booking + review thêm ở V2 (migration sau). Schema reference
// docs/plans/tutoring.md §4.
// ══════════════════════════════════════════════════════════

/**
 * tutor_profile — 1 user → tối đa 1 tutor profile.
 * Tạo lazy khi user click "Trở thành gia sư". status DRAFT cho phép
 * fill thông tin trước khi PUBLISHED (hiện trên /tutors browse).
 */
export const tutorProfile = pgTable('tutor_profile', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** Headline ngắn — vd "Gia sư Toán cao cấp 5 năm kinh nghiệm". */
  headline: text('headline').notNull(),
  /** Bio chi tiết Markdown, 200-2000 chars. */
  bio: text('bio').notNull(),
  /** Giá VND/giờ mặc định. */
  hourlyRateVnd: integer('hourly_rate_vnd').notNull(),
  /** ONLINE | OFFLINE_HN | OFFLINE_HCM | HYBRID. */
  modality: text('modality').notNull().default('ONLINE'),
  avatarUrl: text('avatar_url'),
  bannerUrl: text('banner_url'),
  /** Cached counter — update via cron hoặc trigger sau review/complete. */
  sessionsCompleted: integer('sessions_completed').notNull().default(0),
  /** Rating trung bình 1-5 (cached qua trigger từ tutor_review V2). */
  ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
  ratingCount: integer('rating_count').notNull().default(0),
  /** NONE | KYC_PENDING | KYC_VERIFIED — V1 chỉ NONE; V3 KYC flow. */
  verificationStatus: text('verification_status').notNull().default('NONE'),
  /** Embedding bio+subjects — dùng cho AI matching V2. NULL ở V1. */
  bioEmbedding: vector('bio_embedding', 1024),
  /**
   * V4 T1 (2026-05-22): timestamp lần cuối compute bioEmbedding.
   * Inngest cron daily refresh tutor có embedding stale > 14 ngày
   * hoặc bio đã update sau bioEmbeddingUpdatedAt.
   */
  bioEmbeddingUpdatedAt: timestamp('bio_embedding_updated_at'),
  /**
   * V4 T2 (2026-05-22): Instant Book — bỏ qua confirm 24h, student book ngay
   * status = CONFIRMED. Tutor opt-in vì cần đảm bảo lịch chuẩn xác.
   */
  instantBookEnabled: boolean('instant_book_enabled').notNull().default(false),
  /**
   * V4 T2: cho phép trial 30 phút giảm 50%. Default true.
   * 1 trial / (student, tutor) pair — enforce qua unique partial index.
   */
  trialSessionEnabled: boolean('trial_session_enabled').notNull().default(true),
  /** V4 T2: avg response time (phút) — compute daily cron. */
  avgResponseMinutes: integer('avg_response_minutes'),
  /** V4 T2: response rate % (0-100) — tutor confirm / total booking requested. */
  responseRatePct: integer('response_rate_pct'),
  /**
   * V4 T4 (2026-05-22): token để generate iCal feed URL public (token-protected).
   * Lazy create khi tutor click "Export lịch". Rotate quarterly admin.
   */
  icalToken: text('ical_token'),
  /** V4 T5: video intro 60s MP4 — hiển thị trên profile hero. */
  introVideoUrl: text('intro_video_url'),
  introVideoThumbUrl: text('intro_video_thumb_url'),
  /** DRAFT | PUBLISHED | PAUSED. */
  status: text('status').notNull().default('DRAFT'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('tutor_profile_status_idx').on(t.status),
  modalityIdx: index('tutor_profile_modality_idx').on(t.modality, t.status),
}));

/**
 * V4 T1 (2026-05-22): AI Concierge thread + message.
 *
 * Chat tự nhiên với AI để tìm gia sư — tách khỏi AI Tutor chat:
 *   - AI Tutor: chat về kiến thức trong workspace
 *   - Concierge: chat tìm tutor marketplace
 *
 * Spec: docs/plans/tutoring-v4.md §3 T1.
 */
export const tutoringConciergeThread = pgTable('tutoring_concierge_thread', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** Title auto-generate từ message đầu tiên (vd "Toán 11 dưới 200k"). */
  title: text('title'),
  lastMessageAt: timestamp('last_message_at').notNull().defaultNow(),
  /**
   * Cache filter trích xuất từ chat — re-open cuộc cũ vẫn còn context.
   * Format: { subjectSlug, level, budgetMaxVnd, modality, city, keywords }
   */
  extractedFilters: jsonb('extracted_filters').$type<{
    subjectSlug?: string;
    level?: string;
    budgetMaxVnd?: number;
    modality?: string;
    city?: string;
    keywords?: string[];
  }>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userTimeIdx: index('tutoring_concierge_thread_user_time_idx').on(
    t.userId, t.lastMessageAt,
  ),
}));

export const tutoringConciergeMessage = pgTable('tutoring_concierge_message', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  threadId: text('thread_id').notNull().references(
    () => tutoringConciergeThread.id, { onDelete: 'cascade' },
  ),
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool'
  content: text('content').notNull(),
  /**
   * Tool call result jsonb cho assistant message:
   *   { action: 'search'|'clarify', tutorIds: [], filters: {}, total }
   */
  metadata: jsonb('metadata').$type<{
    action?: 'search' | 'clarify';
    tutorIds?: string[];
    filters?: Record<string, unknown>;
    total?: number;
  }>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  threadTimeIdx: index('tutoring_concierge_message_thread_time_idx').on(
    t.threadId, t.createdAt,
  ),
}));

export type TutoringConciergeThread = typeof tutoringConciergeThread.$inferSelect;
export type TutoringConciergeMessage = typeof tutoringConciergeMessage.$inferSelect;

/**
 * tutor_subject — N môn / 1 tutor. Cho phép verify từng môn riêng.
 * unique(tutorId, subjectSlug, level) tránh trùng.
 */
export const tutorSubject = pgTable(
  'tutor_subject',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    /** Subject slug — xem packages/db/src/taxonomy-subjects.ts cho danh sách. */
    subjectSlug: text('subject_slug').notNull(),
    /** PRIMARY | SECONDARY | HIGH_SCHOOL | UNIVERSITY | ADULT. */
    level: text('level').notNull(),
    /** Verified bởi AI quiz V3 — NULL = chưa verify. */
    verifiedAt: timestamp('verified_at'),
    /** Score quiz 0-100 nếu đã làm. */
    verifyScore: integer('verify_score'),
  },
  (t) => ({
    uniq: uniqueIndex('tutor_subject_uniq').on(t.tutorId, t.subjectSlug, t.level),
    subjectIdx: index('tutor_subject_subject_idx').on(t.subjectSlug, t.level),
  }),
);

/**
 * tutor_availability — recurring weekly slot.
 * V2 sẽ thêm `tutor_availability_override` cho ngày cụ thể.
 */
export const tutorAvailability = pgTable(
  'tutor_availability',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    /** 0=Sunday, 1=Monday, ..., 6=Saturday. */
    dayOfWeek: integer('day_of_week').notNull(),
    /** "HH:MM" 24h format. */
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    /** Default 'Asia/Ho_Chi_Minh'. */
    timezone: text('timezone').notNull().default('Asia/Ho_Chi_Minh'),
  },
  (t) => ({
    tutorIdx: index('tutor_availability_tutor_idx').on(t.tutorId),
  }),
);

/**
 * tutor_request — student post yêu cầu tìm gia sư.
 * Public, các tutor browse và apply qua tutor_application.
 */
export const tutorRequest = pgTable(
  'tutor_request',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    subjectSlug: text('subject_slug').notNull(),
    level: text('level').notNull(),
    /** Budget VND/giờ tối đa (null = thoả thuận). */
    budgetVnd: integer('budget_vnd'),
    modality: text('modality').notNull().default('ONLINE'),
    /** ASAP | THIS_WEEK | THIS_MONTH | FLEXIBLE. */
    urgency: text('urgency').notNull().default('FLEXIBLE'),
    /** OPEN | MATCHED | CLOSED. */
    status: text('status').notNull().default('OPEN'),
    /** Embedding mô tả — match với tutor.bioEmbedding (V2). */
    embedding: vector('embedding', 1024),
    /** V5: timestamp lần cuối refresh embedding (cron skip nếu < 14d). */
    embeddingUpdatedAt: timestamp('embedding_updated_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
  },
  (t) => ({
    subjectIdx: index('tutor_request_subject_idx').on(t.subjectSlug, t.level, t.status),
    studentIdx: index('tutor_request_student_idx').on(t.studentId, t.createdAt),
  }),
);

/**
 * tutor_application — tutor apply vào request.
 * unique(requestId, tutorId) tránh apply 2 lần cùng request.
 */
export const tutorApplication = pgTable(
  'tutor_application',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    requestId: text('request_id')
      .notNull()
      .references(() => tutorRequest.id, { onDelete: 'cascade' }),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    proposedRateVnd: integer('proposed_rate_vnd').notNull(),
    /** PENDING | ACCEPTED | REJECTED | WITHDRAWN. */
    status: text('status').notNull().default('PENDING'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('tutor_application_uniq').on(t.requestId, t.tutorId),
    tutorIdx: index('tutor_application_tutor_idx').on(t.tutorId, t.createdAt),
  }),
);

// Relations — type-safe join cho Drizzle
export const tutorProfileRelations = relations(tutorProfile, ({ one, many }) => ({
  user: one(user, { fields: [tutorProfile.userId], references: [user.id] }),
  subjects: many(tutorSubject),
  availability: many(tutorAvailability),
  applications: many(tutorApplication),
}));

export const tutorSubjectRelations = relations(tutorSubject, ({ one }) => ({
  tutor: one(tutorProfile, {
    fields: [tutorSubject.tutorId],
    references: [tutorProfile.id],
  }),
}));

export const tutorAvailabilityRelations = relations(tutorAvailability, ({ one }) => ({
  tutor: one(tutorProfile, {
    fields: [tutorAvailability.tutorId],
    references: [tutorProfile.id],
  }),
}));

export const tutorRequestRelations = relations(tutorRequest, ({ one, many }) => ({
  student: one(user, { fields: [tutorRequest.studentId], references: [user.id] }),
  applications: many(tutorApplication),
}));

export const tutorApplicationRelations = relations(tutorApplication, ({ one }) => ({
  request: one(tutorRequest, {
    fields: [tutorApplication.requestId],
    references: [tutorRequest.id],
  }),
  tutor: one(tutorProfile, {
    fields: [tutorApplication.tutorId],
    references: [tutorProfile.id],
  }),
}));

// ══════════════════════════════════════════════════════════
// PHASE 21 V2 — BOOKING + REVIEWS
// Sau khi student + tutor thoả thuận qua DM, student book slot từ tutor
// availability → tutor confirm → auto-create study group → session diễn ra
// trên voice channel → recording attach → review.
// ══════════════════════════════════════════════════════════

/**
 * tutoring_booking — buổi học cụ thể giữa 1 student và 1 tutor.
 *
 * Lifecycle:
 *   PENDING_TUTOR → CONFIRMED → IN_PROGRESS → COMPLETED
 *   PENDING_TUTOR → CANCELLED (student/tutor huỷ trước confirm)
 *   CONFIRMED     → CANCELLED (huỷ ≥24h trước startAt; ≤24h thì policy charge)
 *
 * Study group: chỉ auto-create khi CONFIRMED, gắn vào `studyGroupId`. Khi
 * COMPLETED, group KHÔNG xoá — student lưu lại tài liệu + transcript +
 * flashcard cho ôn tập (plan §7.2).
 */
export const tutoringBooking = pgTable(
  'tutoring_booking',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'restrict' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Link tới study group auto-create khi CONFIRMED. NULL trước confirm. */
    studyGroupId: text('study_group_id').references(() => studyGroup.id, {
      onDelete: 'set null',
    }),
    /** Subject slug + level (snapshot tại thời điểm book). */
    subjectSlug: text('subject_slug').notNull(),
    level: text('level').notNull(),
    /** Khung giờ buổi học. */
    startAt: timestamp('start_at').notNull(),
    endAt: timestamp('end_at').notNull(),
    /** Giá VND cố định cho buổi (snapshot từ tutor rate + thoả thuận). */
    rateVnd: integer('rate_vnd').notNull(),
    /** PENDING_TUTOR | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED. */
    status: text('status').notNull().default('PENDING_TUTOR'),
    /** Note ngắn student gửi khi book (mục tiêu buổi học). */
    studentMessage: text('student_message'),
    /** Note tutor để lại sau buổi học. */
    sessionNotes: text('session_notes'),
    /** Recording ID nếu có (Phase 20 V3 voice recording). */
    recordingId: text('recording_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at'),
    completedAt: timestamp('completed_at'),
    cancelledAt: timestamp('cancelled_at'),
    /** userId người huỷ — để show trong UI ai bỏ buổi. */
    cancelledBy: text('cancelled_by'),
    cancelReason: text('cancel_reason'),
    /**
     * V4 T2 (2026-05-22): trial booking giảm 50% rate. 1/student/tutor pair.
     * Enforce qua partial unique index, không cho retry sau cancel.
     */
    isTrial: boolean('is_trial').notNull().default(false),
    /** V4 T2: lưu start time ban đầu trước khi reschedule. */
    originalStartAt: timestamp('original_start_at'),
    /** V4 T2: count số lần đổi lịch — cap max 3. */
    rescheduleCount: integer('reschedule_count').notNull().default(0),
    /**
     * V4 T3 (2026-05-22): buổi học thuộc pack purchase → trừ remaining_sessions
     * thay vì tạo payment riêng. NULL = buổi đơn lẻ.
     */
    packPurchaseId: text('pack_purchase_id'),
  },
  (t) => ({
    tutorTimeIdx: index('tutoring_booking_tutor_time_idx').on(t.tutorId, t.startAt),
    studentTimeIdx: index('tutoring_booking_student_time_idx').on(
      t.studentId,
      t.startAt,
    ),
    statusIdx: index('tutoring_booking_status_idx').on(t.status),
  }),
);

/**
 * tutor_review — student đánh giá tutor sau session.
 *
 * Trigger: chỉ student của booking COMPLETED mới review được. 1 booking →
 * 1 review (unique). Khi insert → update cached rating_avg + rating_count
 * trên tutor_profile (handled ở API layer).
 */
export const tutorReview = pgTable('tutor_review', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  bookingId: text('booking_id')
    .notNull()
    .unique()
    .references(() => tutoringBooking.id, { onDelete: 'cascade' }),
  reviewerId: text('reviewer_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  tutorId: text('tutor_id')
    .notNull()
    .references(() => tutorProfile.id, { onDelete: 'cascade' }),
  /** 1-5. */
  rating: integer('rating').notNull(),
  comment: text('comment'),
  /**
   * Phase 4 admin moderation: hide review khỏi tutor profile (set timestamp).
   * Product query filter `WHERE hidden_at IS NULL`. Vẫn lưu row để forensic.
   */
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  hiddenReason: text('hidden_reason'),
  hiddenBy: text('hidden_by').references(() => user.id, { onDelete: 'set null' }),
  /**
   * V4 T5 (2026-05-22): tag chips student tick (helpful, knowledgeable, …).
   * UI filter qua tag, sort by helpful_count.
   */
  tags: text('tags').array().default(sql`'{}'::text[]`),
  helpfulCount: integer('helpful_count').notNull().default(0),
  attachments: jsonb('attachments').$type<Array<{
    type: 'image' | 'video';
    url: string;
    thumbUrl?: string;
  }>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Relations V2
export const tutoringBookingRelations = relations(tutoringBooking, ({ one }) => ({
  tutor: one(tutorProfile, {
    fields: [tutoringBooking.tutorId],
    references: [tutorProfile.id],
  }),
  student: one(user, {
    fields: [tutoringBooking.studentId],
    references: [user.id],
  }),
  studyGroup: one(studyGroup, {
    fields: [tutoringBooking.studyGroupId],
    references: [studyGroup.id],
  }),
}));

export const tutorReviewRelations = relations(tutorReview, ({ one }) => ({
  booking: one(tutoringBooking, {
    fields: [tutorReview.bookingId],
    references: [tutoringBooking.id],
  }),
  reviewer: one(user, {
    fields: [tutorReview.reviewerId],
    references: [user.id],
  }),
  tutor: one(tutorProfile, {
    fields: [tutorReview.tutorId],
    references: [tutorProfile.id],
  }),
}));

// ══════════════════════════════════════════════════════════
// PHASE 21 V3 — KYC + VERIFICATION QUIZ + PAYMENT
// KYC: tutor upload CCCD + bằng cấp → admin review → KYC_VERIFIED.
// Subject verify quiz: tutor làm AI quiz cho 1 môn → ≥ 80% → badge verified.
// Payment: VNPay/MoMo escrow 7 ngày → tutor payout.
//
// LƯU Ý: payment integration ở V3 hiện scaffold dạng STUB — provider STUB
// auto-capture ngay sau intent (dev), VNPay/MoMo cần merchant credentials
// + webhook public URL để hoạt động thật.
// ══════════════════════════════════════════════════════════

/**
 * tutor_kyc_document — bản gốc CCCD / bằng cấp tutor upload.
 *
 * 1 tutor có N document (CCCD front+back, ≥1 bằng cấp). Lưu storage key trên
 * R2; URL không lưu DB (gen signed URL khi admin xem). PII cao → access log
 * qua audit_log.
 */
export const tutorKycDocument = pgTable(
  'tutor_kyc_document',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    /** CCCD_FRONT | CCCD_BACK | DEGREE | CERTIFICATE | OTHER. */
    docType: text('doc_type').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Tên file gốc — display trong admin UI. */
    originalName: text('original_name').notNull(),
    /** PENDING | APPROVED | REJECTED. */
    status: text('status').notNull().default('PENDING'),
    /** Admin reviewer userId. NULL khi chưa review. */
    reviewedBy: text('reviewed_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at'),
  },
  (t) => ({
    tutorIdx: index('tutor_kyc_document_tutor_idx').on(t.tutorId, t.createdAt),
    statusIdx: index('tutor_kyc_document_status_idx').on(t.status),
  }),
);

/**
 * tutor_subject_verify_quiz — link 1 quiz (reuse quiz table Phase 6) tới
 * 1 tutor_subject để cấp badge "verified" cho môn đó.
 *
 * Flow: tutor click "Verify môn này" → upload tài liệu mẫu → AI generate quiz
 *        10 câu MCQ → tutor làm → score ≥ 80% → status=PASSED → cập nhật
 *        tutor_subject.verifiedAt + verifyScore.
 */
export const tutorSubjectVerifyQuiz = pgTable(
  'tutor_subject_verify_quiz',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    tutorSubjectId: text('tutor_subject_id')
      .notNull()
      .references(() => tutorSubject.id, { onDelete: 'cascade' }),
    /** FK tới quiz table — reuse Phase 6 infrastructure (question + attempt). */
    quizId: text('quiz_id')
      .notNull()
      .references(() => quiz.id, { onDelete: 'cascade' }),
    /** PENDING | PASSED | FAILED. */
    status: text('status').notNull().default('PENDING'),
    /** Score 0-100, NULL khi PENDING. */
    score: integer('score'),
    /** Threshold pass — default 80. */
    passThreshold: integer('pass_threshold').notNull().default(80),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (t) => ({
    subjectIdx: index('tutor_subject_verify_quiz_subject_idx').on(
      t.tutorSubjectId,
    ),
  }),
);

/**
 * tutoring_payment — thanh toán 1 booking.
 *
 * Lifecycle:
 *   CREATED → AUTHORIZED (provider hold tiền) → CAPTURED (release vào escrow)
 *           → REFUNDED (huỷ trong policy) | FAILED
 *
 * Escrow: tiền giữ trong Cogniva account 7 ngày sau session COMPLETED, rồi
 * release vào pool tutor có thể payout. Field `escrowReleaseAt` đánh dấu
 * thời điểm Cogniva cron release.
 *
 * provider:
 *   - STUB    — dev mode, auto-capture ngay sau intent, không gọi API ngoài.
 *   - VNPAY   — sandbox/prod cần VNPAY_TMN_CODE + VNPAY_HASH_SECRET trong env.
 *   - MOMO    — sandbox/prod cần MOMO_PARTNER_CODE + MOMO_SECRET_KEY.
 */
export const tutoringPayment = pgTable(
  'tutoring_payment',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    bookingId: text('booking_id')
      .notNull()
      .unique()
      .references(() => tutoringBooking.id, { onDelete: 'restrict' }),
    /** Tổng tiền student trả (VND). */
    amountVnd: integer('amount_vnd').notNull(),
    /** Phí Cogniva (VND) — V3 default 10% amount, đặt khi capture. */
    feeVnd: integer('fee_vnd').notNull().default(0),
    /** STUB | VNPAY | MOMO. */
    provider: text('provider').notNull().default('STUB'),
    /** Mã giao dịch trả về từ provider (TxnRef VNPay / transId MoMo). */
    providerRef: text('provider_ref'),
    /** Mã đơn hàng nội bộ — đẩy lên provider trong field orderId. */
    orderCode: text('order_code').notNull().unique(),
    /** CREATED | AUTHORIZED | CAPTURED | REFUNDED | FAILED. */
    status: text('status').notNull().default('CREATED'),
    /** Khi nào escrow release vào tutor pool — set khi CAPTURED. */
    escrowReleaseAt: timestamp('escrow_release_at'),
    /** Raw response provider — debug, không expose UI. */
    rawResponse: jsonb('raw_response').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    capturedAt: timestamp('captured_at'),
    refundedAt: timestamp('refunded_at'),
  },
  (t) => ({
    bookingIdx: index('tutoring_payment_booking_idx').on(t.bookingId),
    statusIdx: index('tutoring_payment_status_idx').on(t.status),
  }),
);

/**
 * tutor_payout — tutor yêu cầu rút tiền từ pool escrow released.
 *
 * V3 chỉ ghi nhận request — admin manual transfer + mark PAID. V4+ tự động.
 */
export const tutorPayout = pgTable(
  'tutor_payout',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'restrict' }),
    /** Số tiền yêu cầu (VND). */
    amountVnd: integer('amount_vnd').notNull(),
    /** REQUESTED | APPROVED | PAID | REJECTED. */
    status: text('status').notNull().default('REQUESTED'),
    /** BANK_TRANSFER | MOMO_WALLET — phương thức nhận tiền. */
    method: text('method').notNull().default('BANK_TRANSFER'),
    /** Thông tin tài khoản (jsonb) — bank name + account number + holder. */
    accountDetails: jsonb('account_details').$type<{
      bankName?: string;
      accountNumber?: string;
      accountHolder?: string;
      phone?: string;
    }>(),
    /** Admin xử lý userId. */
    processedBy: text('processed_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    requestedAt: timestamp('requested_at').notNull().defaultNow(),
    processedAt: timestamp('processed_at'),
  },
  (t) => ({
    tutorIdx: index('tutor_payout_tutor_idx').on(t.tutorId, t.requestedAt),
    statusIdx: index('tutor_payout_status_idx').on(t.status),
  }),
);

// Relations V3
export const tutorKycDocumentRelations = relations(tutorKycDocument, ({ one }) => ({
  tutor: one(tutorProfile, {
    fields: [tutorKycDocument.tutorId],
    references: [tutorProfile.id],
  }),
  reviewer: one(user, {
    fields: [tutorKycDocument.reviewedBy],
    references: [user.id],
  }),
}));

export const tutorSubjectVerifyQuizRelations = relations(
  tutorSubjectVerifyQuiz,
  ({ one }) => ({
    subject: one(tutorSubject, {
      fields: [tutorSubjectVerifyQuiz.tutorSubjectId],
      references: [tutorSubject.id],
    }),
    quiz: one(quiz, {
      fields: [tutorSubjectVerifyQuiz.quizId],
      references: [quiz.id],
    }),
  }),
);

export const tutoringPaymentRelations = relations(tutoringPayment, ({ one }) => ({
  booking: one(tutoringBooking, {
    fields: [tutoringPayment.bookingId],
    references: [tutoringBooking.id],
  }),
}));

export const tutorPayoutRelations = relations(tutorPayout, ({ one }) => ({
  tutor: one(tutorProfile, {
    fields: [tutorPayout.tutorId],
    references: [tutorProfile.id],
  }),
}));

// ══════════════════════════════════════════════════════════
// V4 T3 — Wallet + Packs + Promo (migration 0042)
// ══════════════════════════════════════════════════════════

/**
 * userWallet — balance VND per user (1-1). Lazy create khi user nạp tiền lần đầu.
 *
 * Atomicity: mọi mutation balance PHẢI qua transaction wrap với insert
 * user_wallet_txn (ledger row) cùng lúc. Helper `lib/tutoring/wallet.ts`
 * cung cấp `chargeWallet()`, `topupWallet()` để enforce.
 */
export const userWallet = pgTable('user_wallet', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  balanceVnd: integer('balance_vnd').notNull().default(0),
  /** Cashback + promo — không rút được, có expiry. Apply trước balance khi pay. */
  promoBalanceVnd: integer('promo_balance_vnd').notNull().default(0),
  promoExpiresAt: timestamp('promo_expires_at'),
  /** Auto-topup: khi balance < threshold → tự charge VNPay default method. */
  autoTopupThresholdVnd: integer('auto_topup_threshold_vnd'),
  autoTopupAmountVnd: integer('auto_topup_amount_vnd'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * userWalletTxn — ledger immutable cho mọi balance change.
 *
 * Audit: balance_after_vnd lưu để verify ledger consistency (cron daily
 * đối chiếu sum(amount) === current balance, alert nếu lệch).
 */
export const userWalletTxn = pgTable('user_wallet_txn', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** TOPUP | BOOKING_PAY | PACK_PURCHASE | REFUND | CASHBACK | PROMO | PAYOUT_RECEIVED | ADJUSTMENT */
  type: text('type').notNull(),
  /** signed: + nạp / - chi. */
  amountVnd: integer('amount_vnd').notNull(),
  balanceAfterVnd: integer('balance_after_vnd').notNull(),
  /** Loose FK — booking/topup payment id, dùng cho audit không enforce. */
  relatedId: text('related_id'),
  relatedType: text('related_type'),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userTimeIdx: index('user_wallet_txn_user_time_idx').on(t.userId, t.createdAt),
}));

/**
 * tutoringPack — tutor đăng pack 4/8/12 buổi giảm giá.
 *
 * Student mua → tutoring_pack_purchase, mỗi booking trừ remaining_sessions.
 * Pack có thể paused/archived nhưng existing purchase vẫn run (snapshot).
 */
export const tutoringPack = pgTable('tutoring_pack', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tutorId: text('tutor_id').notNull().references(() => tutorProfile.id, { onDelete: 'cascade' }),
  subjectSlug: text('subject_slug').notNull(),
  level: text('level').notNull(),
  /** 4 | 8 | 12 | 16 | 24 sessions. */
  sessionCount: integer('session_count').notNull(),
  durationMin: integer('duration_min').notNull().default(60),
  ratePerSessionVnd: integer('rate_per_session_vnd').notNull(),
  totalVnd: integer('total_vnd').notNull(),
  /** Giảm so với hourly_rate × session_count gốc. */
  discountPct: integer('discount_pct').notNull().default(0),
  status: text('status').notNull().default('ACTIVE'),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tutorIdx: index('tutoring_pack_tutor_idx').on(t.tutorId, t.status),
}));

/**
 * tutoringPackPurchase — student mua pack.
 *
 * Track remaining_sessions; mỗi booking link via tutoringBooking.packPurchaseId
 * trừ -1. installment fields cho trả góp 2/3/4 kỳ.
 */
export const tutoringPackPurchase = pgTable('tutoring_pack_purchase', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  packId: text('pack_id').notNull().references(() => tutoringPack.id, { onDelete: 'restrict' }),
  studentId: text('student_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** Snapshot tổng giá tại lúc mua (pack có thể update sau). */
  totalVnd: integer('total_vnd').notNull(),
  remainingSessions: integer('remaining_sessions').notNull(),
  /** 2/3/4 kỳ hoặc null = trả full. */
  installmentTotalPeriods: integer('installment_total_periods'),
  installmentPaidPeriods: integer('installment_paid_periods').notNull().default(0),
  /** Cron-like "WEEKLY:TUE:19:00" — Inngest cron rollout booking từ pack. */
  recurringSchedule: text('recurring_schedule'),
  status: text('status').notNull().default('ACTIVE'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  studentIdx: index('tutoring_pack_purchase_student_idx').on(t.studentId, t.status),
}));

/**
 * promoCode — admin tạo mã giảm giá.
 *
 * 3 type:
 *   - PERCENTAGE   : value = 0-100 (% giảm)
 *   - FIXED_VND    : value = số VND giảm trực tiếp
 *   - WALLET_CREDIT: value = VND tặng vào promoBalanceVnd
 */
export const promoCode = pgTable('promo_code', {
  code: text('code').primaryKey(),
  type: text('type').notNull(),
  value: integer('value').notNull(),
  maxUses: integer('max_uses'),
  usesCount: integer('uses_count').notNull().default(0),
  perUserLimit: integer('per_user_limit').notNull().default(1),
  minPurchaseVnd: integer('min_purchase_vnd'),
  validFrom: timestamp('valid_from'),
  validUntil: timestamp('valid_until'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const promoCodeRedemption = pgTable('promo_code_redemption', {
  promoCode: text('promo_code').notNull().references(() => promoCode.code, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  amountVnd: integer('amount_vnd').notNull().default(0),
  redeemedAt: timestamp('redeemed_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.promoCode, t.userId] }),
}));

export type UserWallet = typeof userWallet.$inferSelect;
export type UserWalletTxn = typeof userWalletTxn.$inferSelect;
export type TutoringPack = typeof tutoringPack.$inferSelect;
export type TutoringPackPurchase = typeof tutoringPackPurchase.$inferSelect;
export type PromoCode = typeof promoCode.$inferSelect;

// ══════════════════════════════════════════════════════════
// V4 T4 — Group Classes + Blocked Time + iCal (migration 0043)
// ══════════════════════════════════════════════════════════

/**
 * tutoringClass — lớp nhóm 1 tutor → 2-30 student.
 *
 * Schedule recurring (ONE_OFF / WEEKLY / BIWEEKLY) — schedule_slots lưu list
 * "DAY:HH:MM". Auto-create study group khi class start (Inngest cron).
 */
export const tutoringClass = pgTable('tutoring_class', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tutorId: text('tutor_id').notNull().references(() => tutorProfile.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  subjectSlug: text('subject_slug').notNull(),
  level: text('level').notNull(),
  maxStudents: integer('max_students').notNull(),
  enrolledCount: integer('enrolled_count').notNull().default(0),
  ratePerStudentVnd: integer('rate_per_student_vnd').notNull(),
  durationMin: integer('duration_min').notNull().default(90),
  totalSessions: integer('total_sessions').notNull().default(1),
  /** ONE_OFF | WEEKLY | BIWEEKLY */
  scheduleType: text('schedule_type').notNull(),
  /** Format: ["MON:19:00", "WED:19:00"] */
  scheduleSlots: jsonb('schedule_slots').$type<string[]>().notNull(),
  startDate: date('start_date').notNull(),
  studyGroupId: text('study_group_id').references(() => studyGroup.id, { onDelete: 'set null' }),
  /** OPEN | FULL | IN_PROGRESS | COMPLETED | CANCELLED */
  status: text('status').notNull().default('OPEN'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('tutoring_class_status_idx').on(t.status, t.startDate),
  tutorIdx: index('tutoring_class_tutor_idx').on(t.tutorId, t.status),
}));

/**
 * tutoringClassEnrollment — student join class.
 *
 * Payment_id link to tutoringPayment row. Waitlist nếu class full → push lên
 * khi có dropout.
 */
export const tutoringClassEnrollment = pgTable('tutoring_class_enrollment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  classId: text('class_id').notNull().references(() => tutoringClass.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** ENROLLED | WAITLISTED | COMPLETED | DROPPED | REFUNDED */
  status: text('status').notNull().default('ENROLLED'),
  paymentId: text('payment_id'),
  enrolledAt: timestamp('enrolled_at').notNull().defaultNow(),
}, (t) => ({
  classIdx: index('tutoring_class_enrollment_class_idx').on(t.classId, t.status),
  studentIdx: index('tutoring_class_enrollment_student_idx').on(t.studentId, t.status),
  unique: uniqueIndex('tutoring_class_enrollment_uniq').on(t.classId, t.studentId),
}));

/**
 * tutorBlockedTime — tutor block vacation / busy, không cho book trong khoảng.
 *
 * Booking validation phải check không overlap với blocked time.
 */
export const tutorBlockedTime = pgTable('tutor_blocked_time', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tutorId: text('tutor_id').notNull().references(() => tutorProfile.id, { onDelete: 'cascade' }),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tutorIdx: index('tutor_blocked_time_tutor_idx').on(t.tutorId, t.startAt),
}));

export type TutoringClass = typeof tutoringClass.$inferSelect;
export type TutoringClassEnrollment = typeof tutoringClassEnrollment.$inferSelect;
export type TutorBlockedTime = typeof tutorBlockedTime.$inferSelect;

// ══════════════════════════════════════════════════════════
// V4 T5 — Trust & Discovery (migration 0044)
// ══════════════════════════════════════════════════════════

/**
 * tutorReviewHelpful — user click "Hữu ích" review → increment helpful_count.
 * 1 user / review.
 */
export const tutorReviewHelpful = pgTable('tutor_review_helpful', {
  reviewId: text('review_id').notNull().references(() => tutorReview.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.reviewId, t.userId] }),
}));

/**
 * tutorFavorite — user ♥ tutor (heart icon trên TutorCard).
 */
export const tutorFavorite = pgTable('tutor_favorite', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  tutorId: text('tutor_id').notNull().references(() => tutorProfile.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.tutorId] }),
  userIdx: index('tutor_favorite_user_idx').on(t.userId, t.createdAt),
}));

/**
 * tutorSavedSearch — user lưu filter, alert push khi có tutor mới match.
 * Cron daily check tutor mới publish + send notification.
 */
export const tutorSavedSearch = pgTable('tutor_saved_search', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filters: jsonb('filters').$type<{
    subjectSlug?: string;
    level?: string;
    budgetMaxVnd?: number;
    modality?: string;
    keywords?: string[];
  }>().notNull(),
  alertEnabled: boolean('alert_enabled').notNull().default(false),
  lastNotifiedAt: timestamp('last_notified_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('tutor_saved_search_user_idx').on(t.userId),
}));

export type TutorReviewHelpful = typeof tutorReviewHelpful.$inferSelect;
export type TutorFavorite = typeof tutorFavorite.$inferSelect;
export type TutorSavedSearch = typeof tutorSavedSearch.$inferSelect;

// ══════════════════════════════════════════════════════════
// Admin Console (Phase 0) — xem docs/plans/admin.md
// ══════════════════════════════════════════════════════════

/**
 * Log mọi mutation từ admin endpoint — ai/làm gì/khi nào/payload diff.
 * Helper `withAudit()` ở apps/web sẽ auto-insert mỗi mutation.
 *
 * payload format: `{ before?, after?, reason?, metadata? }` — DiffViewer
 * UI render before/after JSON side-by-side.
 */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    adminId: text('admin_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    /** Action key — vd 'user.suspend', 'doc.delete', 'circuit.reset'. */
    action: text('action').notNull(),
    /** Loại entity bị tác động — 'user', 'document', 'group', 'circuit', ... */
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    payload: jsonb('payload').notNull().default({}),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    adminIdx: index('idx_audit_admin').on(t.adminId, t.createdAt),
    targetIdx: index('idx_audit_target').on(t.targetType, t.targetId),
    actionIdx: index('idx_audit_action').on(t.action, t.createdAt),
  }),
);

/**
 * User report content khác (message, user, review, document, group).
 * Admin xử lý qua queue ở /admin/moderation/reports.
 */
export const contentReport = pgTable(
  'content_report',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('PENDING'),
    resolvedBy: text('resolved_by').references(() => user.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** 'dismiss' | 'takedown' | 'warn' | 'ban' — null khi PENDING. */
    resolution: text('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    targetIdx: index('idx_report_target').on(t.targetType, t.targetId),
  }),
);

/**
 * Singleton key-value config — maintenance mode, banner, feature flags.
 * Đọc qua `getSystemConfig(key)` server-only, cache 5s in-memory để giảm DB hit.
 *
 * Key cố định:
 *   'maintenance' → { enabled: bool, banner: string|null, dismissible: bool }
 *   'flags.<name>' → arbitrary JSON cho feature flag
 */
export const systemConfig = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * AI usage log (Phase 3 admin) — 1 row mỗi LLM call cho cost dashboard.
 *
 * Caller: `recordCost()` ở [observability/cost-guardrail.ts] — insert sau khi
 * LLM call xong. Có thể NULL userId nếu là system call (cron, ingest job).
 *
 * Tránh insert quá nhiều row vô nghĩa: cached call (semantic-cache hit) vẫn
 * insert với `cached=true` + `costUsd=0` → phân tích cache hit ratio.
 */
export const aiUsageLog = pgTable(
  'ai_usage_log',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    plan: text('plan'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    feature: text('feature'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    latencyMs: integer('latency_ms'),
    cached: boolean('cached').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerTimeIdx: index('idx_ai_usage_provider_time').on(t.provider, t.createdAt),
    userTimeIdx: index('idx_ai_usage_user_time').on(t.userId, t.createdAt),
    timeIdx: index('idx_ai_usage_time').on(t.createdAt),
  }),
);

// ──────────────────────────────────────────────────────────
// Kiểu dòng đã suy luận — dùng trong app code để type response
// ──────────────────────────────────────────────────────────
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Workspace = typeof workspace.$inferSelect;
export type Document = typeof document.$inferSelect;
export type Chunk = typeof chunk.$inferSelect;
export type Concept = typeof concept.$inferSelect;
export type Flashcard = typeof flashcard.$inferSelect;
export type Quiz = typeof quiz.$inferSelect;
export type Conversation = typeof conversation.$inferSelect;
export type Message = typeof message.$inferSelect;
export type Room = typeof room.$inferSelect;
export type NewRoom = typeof room.$inferInsert;
export type RoomMember = typeof roomMember.$inferSelect;
export type RoomMessage = typeof roomMessage.$inferSelect;
export type Recording = typeof recording.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
export type DeletionRequest = typeof deletionRequest.$inferSelect;
export type NewDeletionRequest = typeof deletionRequest.$inferInsert;
export type PushToken = typeof pushToken.$inferSelect;
export type NewPushToken = typeof pushToken.$inferInsert;
export type NotificationLog = typeof notificationLog.$inferSelect;
export type NewNotificationLog = typeof notificationLog.$inferInsert;
export type Exam = typeof exam.$inferSelect;
export type NewExam = typeof exam.$inferInsert;
export type ExamQuestion = typeof examQuestion.$inferSelect;
export type NewExamQuestion = typeof examQuestion.$inferInsert;
export type ExamAttempt = typeof examAttempt.$inferSelect;
export type NewExamAttempt = typeof examAttempt.$inferInsert;
export type ExamResponse = typeof examResponse.$inferSelect;
export type NewExamResponse = typeof examResponse.$inferInsert;
export type ExamViolation = typeof examViolation.$inferSelect;
export type NewExamViolation = typeof examViolation.$inferInsert;

// Phase 20 V2 — DM
export type DmThread = typeof dmThread.$inferSelect;
export type NewDmThread = typeof dmThread.$inferInsert;
export type DmMessage = typeof dmMessage.$inferSelect;
export type NewDmMessage = typeof dmMessage.$inferInsert;

// Phase 20 — Study Group Channels
export type StudyGroup = typeof studyGroup.$inferSelect;
export type NewStudyGroup = typeof studyGroup.$inferInsert;
export type StudyGroupMember = typeof studyGroupMember.$inferSelect;
export type NewStudyGroupMember = typeof studyGroupMember.$inferInsert;
export type StudyGroupChannel = typeof studyGroupChannel.$inferSelect;
export type NewStudyGroupChannel = typeof studyGroupChannel.$inferInsert;
export type StudyGroupMessage = typeof studyGroupMessage.$inferSelect;
export type NewStudyGroupMessage = typeof studyGroupMessage.$inferInsert;
export type StudyGroupInvite = typeof studyGroupInvite.$inferSelect;
export type NewStudyGroupInvite = typeof studyGroupInvite.$inferInsert;
export type StudyGroupReadState = typeof studyGroupReadState.$inferSelect;
export type StudyGroupVoiceState = typeof studyGroupVoiceState.$inferSelect;

// Phase 21 V1 — Tutoring Marketplace
export type TutorProfile = typeof tutorProfile.$inferSelect;
export type NewTutorProfile = typeof tutorProfile.$inferInsert;
export type TutorSubject = typeof tutorSubject.$inferSelect;
export type NewTutorSubject = typeof tutorSubject.$inferInsert;
export type TutorAvailability = typeof tutorAvailability.$inferSelect;
export type NewTutorAvailability = typeof tutorAvailability.$inferInsert;
export type TutorRequest = typeof tutorRequest.$inferSelect;
export type NewTutorRequest = typeof tutorRequest.$inferInsert;
export type TutorApplication = typeof tutorApplication.$inferSelect;
export type NewTutorApplication = typeof tutorApplication.$inferInsert;

// Phase 21 V2 — Booking + Review
export type TutoringBooking = typeof tutoringBooking.$inferSelect;
export type NewTutoringBooking = typeof tutoringBooking.$inferInsert;
export type TutorReview = typeof tutorReview.$inferSelect;
export type NewTutorReview = typeof tutorReview.$inferInsert;

// Phase 21 V3 — KYC + Verify Quiz + Payment
export type TutorKycDocument = typeof tutorKycDocument.$inferSelect;
export type NewTutorKycDocument = typeof tutorKycDocument.$inferInsert;
export type TutorSubjectVerifyQuiz = typeof tutorSubjectVerifyQuiz.$inferSelect;
export type NewTutorSubjectVerifyQuiz = typeof tutorSubjectVerifyQuiz.$inferInsert;
export type TutoringPayment = typeof tutoringPayment.$inferSelect;
export type NewTutoringPayment = typeof tutoringPayment.$inferInsert;
export type TutorPayout = typeof tutorPayout.$inferSelect;
export type NewTutorPayout = typeof tutorPayout.$inferInsert;

// Admin Console (Phase 0)
export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT';
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLog.$inferInsert;
export type ContentReport = typeof contentReport.$inferSelect;
export type NewContentReport = typeof contentReport.$inferInsert;
export type SystemConfig = typeof systemConfig.$inferSelect;
export type NewSystemConfig = typeof systemConfig.$inferInsert;

// ============================================================================
// LIBRARY — Phase 1 (2026-05-22)
// Spec: docs/plans/library-share.md
// Migration: 0046_library_doc.sql
// ============================================================================

/**
 * library_doc — master record cho mỗi tài liệu publish lên kho công khai.
 *
 * Status flow: PROCESSING (đang ingest) → PUBLISHED → HIDDEN/REPORTED/REVIEWING.
 *
 * Khác workspace document ở chỗ: public + có metadata phong phú + outcome
 * tracking + atom extraction (Phase 2). Có thể clone vào workspace bằng
 * library_doc_import.
 */
export const libraryDoc = pgTable(
  'library_doc',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    uploaderId: text('uploader_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    // Content metadata
    title: text('title').notNull(),
    description: text('description'),
    subjectSlug: text('subject_slug').notNull(),
    level: text('level').notNull(),
    /** 1-12 (null cho non-K-12 như ADULT/UNIVERSITY). */
    grade: integer('grade'),
    /** lecture_notes/summary/exam/exercise/solution/reference_book/thesis/handout/mind_map/other. */
    docType: text('doc_type').notNull().default('other'),
    /** midterm/final/graduation/university_entrance/gifted_student (chỉ khi docType=exam). */
    examType: text('exam_type'),
    /** '2023-2024' format. */
    schoolYear: text('school_year'),
    /** national/hanoi/hcm/danang/... */
    region: text('region').default('national'),
    language: text('language').default('vi'),
    /** Topics/sub-tags array, vd ['đạo hàm', 'tích phân']. */
    tags: text('tags').array().default(sql`'{}'::text[]`),
    /** easy/medium/hard — Phase 2 AI detect. */
    difficulty: text('difficulty'),
    /** Atom slugs cần biết trước khi học doc này (Phase 2). */
    prerequisiteAtomSlugs: text('prerequisite_atom_slugs')
      .array()
      .default(sql`'{}'::text[]`),

    // File metadata
    /** pdf | docx | image. */
    fileFormat: text('file_format').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    fileUrl: text('file_url').notNull(),
    /** SHA-256 dedup. */
    fileHash: text('file_hash').notNull(),
    pageCount: integer('page_count'),

    // Generated content
    previewThumbUrl: text('preview_thumb_url'),
    aiSummary: text('ai_summary'),
    aiSummaryAt: timestamp('ai_summary_at'),
    previewText: text('preview_text'),

    // Search index (search_vec generated stored column)
    titleEmbedding: vector('title_embedding', 1024),

    // License + status
    license: text('license').default('CC-BY-4.0'),
    status: text('status').notNull().default('PROCESSING'),
    hiddenAt: timestamp('hidden_at'),
    hiddenReason: text('hidden_reason'),

    // Stats
    viewCount: integer('view_count').notNull().default(0),
    downloadCount: integer('download_count').notNull().default(0),
    workspaceImportCount: integer('workspace_import_count').notNull().default(0),
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
    ratingCount: integer('rating_count').notNull().default(0),

    // Quality Score (Phase 2 weighted blend)
    qualityScore: numeric('quality_score', { precision: 5, scale: 2 }),
    qualityBreakdown: jsonb('quality_breakdown'),
    badges: text('badges').array().default(sql`'{}'::text[]`),

    /** Phase 3 Bonus #12: nếu doc là remix → source doc ids + count. */
    parentRemixDocIds: text('parent_remix_doc_ids').array().default(sql`'{}'::text[]`),
    remixCount: integer('remix_count').notNull().default(0),

    // Pricing (Phase 4)
    isPremium: boolean('is_premium').notNull().default(false),
    priceVnd: integer('price_vnd'),
    creatorSharePct: integer('creator_share_pct').notNull().default(80),

    // University → Course model (migration 0053). subject_slug giữ legacy.
    courseId: text('course_id').references((): AnyPgColumn => libraryCourse.id, {
      onDelete: 'set null',
    }),
    universityId: text('university_id').references((): AnyPgColumn => libraryUniversity.id, {
      onDelete: 'set null',
    }),
    /** Denormalize tên course (+code) để index vào search_vec. */
    courseNameCache: text('course_name_cache'),
    /** Denormalize tên + viết tắt trường để search "hust" ra doc của trường. */
    universityNameCache: text('university_name_cache'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    subjectGradeIdx: index('library_doc_subject_grade_idx').on(
      t.subjectSlug,
      t.grade,
      t.status,
    ),
    subjectLevelIdx: index('library_doc_subject_level_idx').on(
      t.subjectSlug,
      t.level,
      t.status,
    ),
    typeIdx: index('library_doc_type_idx').on(t.docType, t.status),
    uploaderIdx: index('library_doc_uploader_idx').on(t.uploaderId),
    courseIdx: index('library_doc_course_idx').on(t.courseId, t.status),
    universityIdx: index('library_doc_university_idx').on(t.universityId, t.status),
  }),
);

/**
 * library_university — trường đại học/tổ chức giáo dục (migration 0053).
 * UGC: user tạo khi upload, autocomplete dedup, admin merge sau.
 */
export const libraryUniversity = pgTable('library_university', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  shortName: text('short_name'),
  country: text('country').notNull().default('VN'),
  logoUrl: text('logo_url'),
  docCount: integer('doc_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * library_course — môn học/khoá học (migration 0053). Đơn vị phân loại chính
 * thay subject taxonomy. Optional university (course general OK).
 */
export const libraryCourse = pgTable(
  'library_course',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    universityId: text('university_id').references(() => libraryUniversity.id, {
      onDelete: 'set null',
    }),
    code: text('code'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Broad area (legacy subject slug) để group/filter. Optional. */
    subjectArea: text('subject_area'),
    docCount: integer('doc_count').notNull().default(0),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    universityIdx: index('library_course_university_idx').on(t.universityId, t.docCount),
    subjectIdx: index('library_course_subject_idx').on(t.subjectArea),
  }),
);

/**
 * library_doc_chunk — page-level chunks cho cross-doc semantic search (Pillar #2).
 *
 * Mỗi page → split paragraph thành chunks, embed riêng. Search vector across
 * tất cả chunks → trả về (doc, page, đoạn highlighted).
 */
export const libraryDocChunk = pgTable(
  'library_doc_chunk',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    pageNum: integer('page_num').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    contentVec: vector('content_vec', 1024),
  },
  (t) => ({
    docIdx: index('library_doc_chunk_doc_idx').on(t.docId, t.pageNum),
  }),
);

/**
 * library_doc_atom — atoms extracted từ doc (Phase 2).
 *
 * 1 atom = 1 concept đơn (vd "đạo hàm hàm hợp"). Track page_nums chứa atom
 * để Smart Reading mode (Pillar #3) hide pages user đã master.
 */
export const libraryDocAtom = pgTable(
  'library_doc_atom',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    atomText: text('atom_text').notNull(),
    /** Slugify cho dedup cross-doc (cùng atom xuất hiện nhiều doc). */
    atomSlug: text('atom_slug').notNull(),
    /** Pages chứa atom này. */
    pageNums: integer('page_nums').array().notNull(),
    difficulty: text('difficulty'),
    embedding: vector('embedding', 1024),
  },
  (t) => ({
    slugIdx: index('library_doc_atom_slug_idx').on(t.atomSlug),
    docIdx: index('library_doc_atom_doc_idx').on(t.docId),
  }),
);

/** library_doc_review — rating + comment. 1 user 1 review / doc. */
export const libraryDocReview = pgTable(
  'library_doc_review',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    helpfulCount: integer('helpful_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('library_doc_review_uniq').on(t.docId, t.reviewerId),
    docIdx: index('library_doc_review_doc_idx').on(t.docId, t.createdAt),
  }),
);

/**
 * library_doc_import — track việc user clone doc vào workspace.
 *
 * Khi import: copy file URL → workspace document table, INSERT row này
 * để metric workspace_import_count + outcome tracking sau (Phase 2).
 */
export const libraryDocImport = pgTable(
  'library_doc_import',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id),
    importerId: text('importer_id')
      .notNull()
      .references(() => user.id),
    workspaceId: text('workspace_id').references(() => workspace.id, {
      onDelete: 'set null',
    }),
    documentId: text('document_id').references(() => document.id, {
      onDelete: 'set null',
    }),
    importedAt: timestamp('imported_at').notNull().defaultNow(),
  },
  (t) => ({
    docIdx: index('library_doc_import_doc_idx').on(t.docId, t.importedAt),
    userIdx: index('library_doc_import_user_idx').on(
      t.importerId,
      t.importedAt,
    ),
  }),
);

/**
 * library_doc_outcome — outcome signals cho Quality Score (Phase 2).
 *
 * Track metric thực: score_delta sau dùng doc, quiz_pass_rate, time_spent,
 * atom_mastered_count → tổng hợp thành quality_score.
 */
export const libraryDocOutcome = pgTable(
  'library_doc_outcome',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    /** score_delta/time_spent/quiz_pass_rate/atom_mastered_count. */
    metric: text('metric').notNull(),
    value: numeric('value').notNull(),
    context: jsonb('context'),
    recordedAt: timestamp('recorded_at').notNull().defaultNow(),
  },
  (t) => ({
    docMetricIdx: index('library_doc_outcome_doc_idx').on(t.docId, t.metric),
    userIdx: index('library_doc_outcome_user_idx').on(t.userId),
  }),
);

/** library_doc_report — abuse/copyright report queue. */
export const libraryDocReport = pgTable(
  'library_doc_report',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => user.id),
    /** spam/copyright/misinfo/inappropriate. */
    reason: text('reason').notNull(),
    detail: text('detail'),
    /** PENDING/ACTIONED/DISMISSED. */
    status: text('status').notNull().default('PENDING'),
    adminId: text('admin_id').references(() => user.id),
    actionedAt: timestamp('actioned_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('library_doc_report_status_idx').on(t.status, t.createdAt),
  }),
);

/**
 * Phase 3 Bonus #8 — library_doc_annotation: page-level note 1 user gắn
 * cho 1 doc tại 1 page. Visibility public/private. helpful_count crowd
 * signal — top 5 "most helpful" sẽ hiện overlay PDF Phase 4.
 */
export const libraryDocAnnotation = pgTable(
  'library_doc_annotation',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    pageNum: integer('page_num').notNull(),
    /** Note markdown text max 2000 char. */
    note: text('note').notNull(),
    /** Phase 4: optional — đoạn text user select khi tạo note. */
    selectedText: text('selected_text'),
    /** Phase 4: optional pixel coords {pageW, pageH, x, y, w, h} normalized
     *  0..1 relative PDF page. Dùng cho overlay highlight rendering. */
    selectionRect: jsonb('selection_rect').$type<{
      pageW: number;
      pageH: number;
      x: number;
      y: number;
      w: number;
      h: number;
    }>(),
    /** 'public' | 'private'. */
    visibility: text('visibility').notNull().default('public'),
    helpfulCount: integer('helpful_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    docIdx: index('library_doc_annotation_doc_idx').on(t.docId, t.pageNum),
    authorIdx: index('library_doc_annotation_author_idx').on(t.authorId, t.createdAt),
    helpfulIdx: index('library_doc_annotation_helpful_idx').on(t.docId, t.helpfulCount),
  }),
);

/**
 * Phase 4 — saved search bookmarks. User save query params + optional
 * push notify khi có doc mới match.
 */
export const librarySavedSearch = pgTable(
  'library_saved_search',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    queryParams: jsonb('query_params').$type<Record<string, string | number | string[]>>().notNull(),
    notifyOnNew: boolean('notify_on_new').notNull().default(false),
    lastRunAt: timestamp('last_run_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('library_saved_search_user_idx').on(t.userId, t.createdAt),
  }),
);

/**
 * Phase 4 — Per-user view history. Upsert pattern: 1 row/(user × doc),
 * update viewed_at khi user vào lại detail page.
 */
export const libraryDocView = pgTable(
  'library_doc_view',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('library_doc_view_uniq').on(t.userId, t.docId),
    recentIdx: index('library_doc_view_user_recent_idx').on(t.userId, t.viewedAt),
  }),
);

/**
 * Phase 4 Step 5 — Premium doc purchase ledger (migration 0052).
 *
 * Buyer trả VND để unlock isPremium=true doc. Unique (doc_id, buyer_id) chống
 * double-charge. Lưu snapshot creator_share + platform_share tại lúc mua —
 * admin update creator_share_pct sau không ảnh hưởng giao dịch cũ.
 */
export const libraryDocPurchase = pgTable(
  'library_doc_purchase',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Snapshot giá tại lúc mua (VND). */
    priceVnd: integer('price_vnd').notNull(),
    /** Phần creator nhận (theo creator_share_pct snapshot). */
    creatorShareVnd: integer('creator_share_vnd').notNull(),
    /** Phần platform giữ. */
    platformShareVnd: integer('platform_share_vnd').notNull(),
    /** FK lỏng tới user_wallet_txn.id của giao dịch CHARGE buyer (audit). */
    walletTxnId: text('wallet_txn_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('library_doc_purchase_unique').on(t.docId, t.buyerId),
    buyerIdx: index('library_doc_purchase_buyer_idx').on(t.buyerId, t.createdAt),
    docIdx: index('library_doc_purchase_doc_idx').on(t.docId, t.createdAt),
  }),
);

/**
 * Phase 3 Bonus #12 — Creator karma points per user.
 * Increment khi: doc imported (+1) / doc remixed (+5) / endorsed (+10) /
 *               quality ≥ 80 (+20).
 */
export const libraryCreatorKarma = pgTable(
  'library_creator_karma',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    points: integer('points').notNull().default(0),
    /** Top 10 contributor cập nhật rank weekly. */
    rank: integer('rank'),
    lastEventAt: timestamp('last_event_at'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    pointsIdx: index('library_creator_karma_points_idx').on(t.points),
  }),
);

export const libraryKarmaEvent = pgTable(
  'library_karma_event',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 'doc_imported' | 'doc_remixed' | 'endorsed' | 'high_quality'. */
    eventType: text('event_type').notNull(),
    points: integer('points').notNull(),
    docId: text('doc_id').references(() => libraryDoc.id, { onDelete: 'set null' }),
    context: jsonb('context'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('library_karma_event_user_idx').on(t.userId, t.createdAt),
    typeIdx: index('library_karma_event_type_idx').on(t.eventType, t.createdAt),
  }),
);

export const libraryDocAnnotationVote = pgTable(
  'library_doc_annotation_vote',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    annotationId: text('annotation_id')
      .notNull()
      .references(() => libraryDocAnnotation.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('library_doc_annotation_vote_uniq').on(t.annotationId, t.userId),
    userIdx: index('library_doc_annotation_vote_user_idx').on(t.userId),
  }),
);

/**
 * Phase 3 Bonus — library_doc_endorsement: verified tutor endorse 1 library doc
 * → cộng signal vào educator_approved badge (quality score formula).
 */
export const libraryDocEndorsement = pgTable(
  'library_doc_endorsement',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    /** Optional note tutor giải thích vì sao endorse. */
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('library_doc_endorsement_uniq').on(t.docId, t.tutorId),
    docIdx: index('library_doc_endorsement_doc_idx').on(t.docId, t.createdAt),
    tutorIdx: index('library_doc_endorsement_tutor_idx').on(t.tutorId, t.createdAt),
  }),
);

// Type exports
export type LibraryDoc = typeof libraryDoc.$inferSelect;
export type NewLibraryDoc = typeof libraryDoc.$inferInsert;
export type LibraryDocChunk = typeof libraryDocChunk.$inferSelect;
export type NewLibraryDocChunk = typeof libraryDocChunk.$inferInsert;
export type LibraryDocAtom = typeof libraryDocAtom.$inferSelect;
export type NewLibraryDocAtom = typeof libraryDocAtom.$inferInsert;
export type LibraryDocReview = typeof libraryDocReview.$inferSelect;
export type NewLibraryDocReview = typeof libraryDocReview.$inferInsert;
export type LibraryDocImport = typeof libraryDocImport.$inferSelect;
export type NewLibraryDocImport = typeof libraryDocImport.$inferInsert;
export type LibraryDocOutcome = typeof libraryDocOutcome.$inferSelect;
export type NewLibraryDocOutcome = typeof libraryDocOutcome.$inferInsert;
export type LibraryDocReport = typeof libraryDocReport.$inferSelect;
export type NewLibraryDocReport = typeof libraryDocReport.$inferInsert;
export type LibraryDocEndorsement = typeof libraryDocEndorsement.$inferSelect;
export type NewLibraryDocEndorsement = typeof libraryDocEndorsement.$inferInsert;
export type LibraryDocAnnotation = typeof libraryDocAnnotation.$inferSelect;
export type NewLibraryDocAnnotation = typeof libraryDocAnnotation.$inferInsert;
export type LibraryDocAnnotationVote = typeof libraryDocAnnotationVote.$inferSelect;
export type NewLibraryDocAnnotationVote = typeof libraryDocAnnotationVote.$inferInsert;
export type LibraryCreatorKarma = typeof libraryCreatorKarma.$inferSelect;
export type NewLibraryCreatorKarma = typeof libraryCreatorKarma.$inferInsert;
export type LibraryKarmaEvent = typeof libraryKarmaEvent.$inferSelect;
export type NewLibraryKarmaEvent = typeof libraryKarmaEvent.$inferInsert;
export type LibrarySavedSearch = typeof librarySavedSearch.$inferSelect;
export type NewLibrarySavedSearch = typeof librarySavedSearch.$inferInsert;
export type LibraryDocView = typeof libraryDocView.$inferSelect;
export type NewLibraryDocView = typeof libraryDocView.$inferInsert;
export type LibraryDocPurchase = typeof libraryDocPurchase.$inferSelect;
export type NewLibraryDocPurchase = typeof libraryDocPurchase.$inferInsert;
export type LibraryUniversity = typeof libraryUniversity.$inferSelect;
export type NewLibraryUniversity = typeof libraryUniversity.$inferInsert;
export type LibraryCourse = typeof libraryCourse.$inferSelect;
export type NewLibraryCourse = typeof libraryCourse.$inferInsert;
