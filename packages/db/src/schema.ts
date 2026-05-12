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
 *     migrate dim này (xem plan.md §3.3).
 *   - HNSW index tạo qua sql template tag vì Drizzle hiện chưa có API cao
 *     cấp cho operator class `vector_cosine_ops`.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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
export const concept = pgTable(
  'concept',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    name: text('name').notNull(),
    description: text('description'),
    /** Lĩnh vực — "math", "biology", "history"… dùng để filter graph. */
    domain: text('domain').notNull(),
    embedding: vector('embedding', 1024),
  },
  (t) => ({
    embeddingIdx: index('concept_embedding_idx').using(
      'hnsw',
      sql`${t.embedding} vector_cosine_ops`,
    ),
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
  },
  (t) => ({
    uniq: uniqueIndex('mastery_user_concept_uniq').on(t.userId, t.conceptId),
  }),
);

// ──────────────────────────────────────────────────────────
// Domain — Conversation + Message
// ──────────────────────────────────────────────────────────
/** Cuộc hội thoại — gom các message của 1 luồng chat. */
export const conversation = pgTable('conversation', {
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
});

/**
 * Mỗi message trong cuộc hội thoại — citation lưu list chunk làm nguồn,
 * metadata lưu thông tin chi phí/độ trễ để dashboard observability.
 */
export const message = pgTable('message', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  citations: jsonb('citations').$type<Citation[]>().default([]).notNull(),
  metadata: jsonb('metadata').$type<MessageMetadata>().default({}).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

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
export const quiz = pgTable('quiz', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  config: jsonb('config').$type<QuizConfig>().default({}).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

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
export const studyPlanStatusEnum = pgEnum('study_plan_status', ['PENDING', 'DONE']);

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
 * Nhóm học — shared workspace cho nhiều user.
 * Phase 9 v1: chỉ list members + invite code. Phase 10+ thực sự share data.
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
    /** Token random — share với người khác để họ join. */
    inviteCode: text('invite_code').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    inviteIdx: index('study_group_invite_idx').on(t.inviteCode),
  }),
);

export const groupRoleEnum = pgEnum('group_role', ['OWNER', 'MEMBER']);

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
  },
  (t) => ({
    uniq: uniqueIndex('study_group_member_uniq').on(t.groupId, t.userId),
    userIdx: index('study_group_member_user_idx').on(t.userId),
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
    roomId: text('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'cascade' }),
    egressId: text('egress_id').unique(),
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
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // Dedupe query: SELECT WHERE userId + type + createdAt > now() - 24h
    userTypeIdx: index('notification_log_user_type_idx').on(t.userId, t.type, t.createdAt),
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

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const workspaceRelations = relations(workspace, ({ one, many }) => ({
  user: one(user, { fields: [workspace.userId], references: [user.id] }),
  documents: many(document),
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
  concept: one(concept, { fields: [flashcard.conceptId], references: [concept.id] }),
  sourceChunk: one(chunk, { fields: [flashcard.sourceChunkId], references: [chunk.id] }),
  reviews: many(review),
}));

export const reviewRelations = relations(review, ({ one }) => ({
  flashcard: one(flashcard, { fields: [review.flashcardId], references: [flashcard.id] }),
}));

export const quizRelations = relations(quiz, ({ one, many }) => ({
  user: one(user, { fields: [quiz.userId], references: [user.id] }),
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
}));

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
