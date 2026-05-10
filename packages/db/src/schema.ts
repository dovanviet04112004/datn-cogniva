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
 *   - Cột `embedding` dùng vector(1536) — tương thích với:
 *       text-embedding-3-large (gọi với `dimensions: 1536`)
 *       text-embedding-3-small (1536 chiều native, rẻ hơn 6x)
 *     Phải dưới 2000 vì pgvector HNSW index không hỗ trợ >2000 chiều.
 *     Khi muốn dùng full 3072: chuyển sang halfvec hoặc IVFFlat (xem plan.md §5).
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
  preferences: jsonb('preferences').$type<UserPreferences>().default({}).notNull(),
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
    embedding: vector('embedding', 1536),
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
    embedding: vector('embedding', 1536),
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

export const chunkRelations = relations(chunk, ({ one }) => ({
  document: one(document, { fields: [chunk.documentId], references: [document.id] }),
}));

// concept có 2 quan hệ self-reference (outgoing/incoming) qua bảng concept_relation
// → phải đặt relationName để Drizzle phân biệt được 2 chiều.
export const conceptRelations = relations(concept, ({ many }) => ({
  outgoing: many(conceptRelation, { relationName: 'concept_outgoing' }),
  incoming: many(conceptRelation, { relationName: 'concept_incoming' }),
  flashcards: many(flashcard),
  mastery: many(mastery),
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
