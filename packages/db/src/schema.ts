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

export const planEnum = pgEnum('plan', ['FREE', 'PRO', 'TEAM']);

export const parentalConsentStatusEnum = pgEnum('parental_consent_status', [
  'NOT_REQUIRED',
  'PENDING',
  'VERIFIED',
  'REJECTED',
]);

export const docStatusEnum = pgEnum('doc_status', ['UPLOADING', 'PROCESSING', 'READY', 'FAILED']);

export const messageRoleEnum = pgEnum('message_role', ['USER', 'ASSISTANT', 'SYSTEM']);

export const cardTypeEnum = pgEnum('card_type', ['BASIC', 'CLOZE', 'IMAGE_OCCLUSION']);

export const fsrsStateEnum = pgEnum('fsrs_state', ['NEW', 'LEARNING', 'REVIEW', 'RELEARNING']);

export const questionTypeEnum = pgEnum('question_type', [
  'MCQ',
  'TRUE_FALSE',
  'SHORT',
  'ESSAY',
  'FILL_BLANK',
]);

export const sessionTypeEnum = pgEnum('session_type', ['CHAT', 'FLASHCARD', 'QUIZ', 'READING']);

export const roomTypeEnum = pgEnum('room_type', ['STUDY', 'CLASSROOM', 'EXAM', 'OFFICE_HOURS']);

export const roomVisibilityEnum = pgEnum('room_visibility', ['PRIVATE', 'UNLISTED', 'PUBLIC']);

export const roomStatusEnum = pgEnum('room_status', ['IDLE', 'ACTIVE', 'ENDED']);

export const roomMemberRoleEnum = pgEnum('room_member_role', ['OWNER', 'MODERATOR', 'MEMBER']);

export const roomMemberStatusEnum = pgEnum('room_member_status', [
  'ACTIVE',
  'PENDING',
  'KICKED',
  'BANNED',
]);

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  plan: planEnum('plan').notNull().default('FREE'),
  isPublic: boolean('is_public').notNull().default(false),
  preferences: jsonb('preferences').$type<UserPreferences>().default({}).notNull(),
  dateOfBirth: timestamp('date_of_birth', { mode: 'date' }),
  parentalConsentStatus: parentalConsentStatusEnum('parental_consent_status')
    .notNull()
    .default('NOT_REQUIRED'),
  parentEmail: text('parent_email'),
  parentalConsentAt: timestamp('parental_consent_at'),
  status: text('status').notNull().default('online'),
  statusText: text('status_text'),
  statusEmoji: text('status_emoji'),
  statusExpiresAt: timestamp('status_expires_at'),
  adminRole: text('admin_role'),
  suspendedAt: timestamp('suspended_at'),
  suspendReason: text('suspend_reason'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  bookingIcalToken: text('booking_ical_token'),
  proUntilAt: timestamp('pro_until_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
});

export const workspace = pgTable(
  'workspace',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('workspace_user_idx').on(t.userId),
  }),
);

export const workspaceCachedKindEnum = pgEnum('workspace_cached_kind', ['atom-guide', 'briefing']);

export const workspaceCachedOutput = pgTable(
  'workspace_cached_output',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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

export const document = pgTable(
  'document',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
    status: docStatusEnum('status').notNull().default('PROCESSING'),
    metadata: jsonb('metadata').$type<DocumentMetadata>().default({}).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userWorkspaceIdx: index('document_user_workspace_idx').on(t.userId, t.workspaceId),
  }),
);

export const chunk = pgTable(
  'chunk',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    documentId: text('document_id')
      .notNull()
      .references(() => document.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    embedding: vector('embedding', 1024),
    metadata: jsonb('metadata').$type<ChunkMetadata>().notNull(),
    tokens: integer('tokens').notNull(),
  },
  (t) => ({
    docIdx: index('chunk_doc_idx').on(t.documentId),
    embeddingIdx: index('chunk_embedding_idx').using('hnsw', sql`${t.embedding} vector_cosine_ops`),
    contentTsvIdx: index('chunk_content_tsv_idx').using(
      'gin',
      sql`to_tsvector('english', ${t.content})`,
    ),
  }),
);

export const chunkConcept = pgTable(
  'chunk_concept',
  {
    chunkId: text('chunk_id')
      .notNull()
      .references(() => chunk.id, { onDelete: 'cascade' }),
    conceptId: text('concept_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    strength: real('strength').notNull().default(1),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chunkId, t.conceptId] }),
    conceptIdx: index('chunk_concept_concept_idx').on(t.conceptId),
  }),
);

export const concept = pgTable(
  'concept',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text('name').notNull(),
    description: text('description'),
    domain: text('domain').notNull(),
    embedding: vector('embedding', 1024),
    examples: jsonb('examples').$type<string[]>().notNull().default([]),
    difficulty: real('difficulty'),
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

export const conceptRelation = pgTable(
  'concept_relation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    fromId: text('from_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    toId: text('to_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    relationType: text('relation_type').notNull(),
    strength: real('strength').notNull().default(1),
  },
  (t) => ({
    uniq: uniqueIndex('concept_relation_uniq').on(t.fromId, t.toId, t.relationType),
  }),
);

export const mastery = pgTable(
  'mastery',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    conceptId: text('concept_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    score: real('score').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    correct: integer('correct').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at'),
    decayedAt: timestamp('decayed_at'),
    lastQuizAt: timestamp('last_quiz_at'),
    lastFlashcardAt: timestamp('last_flashcard_at'),
    lastExamAt: timestamp('last_exam_at'),
  },
  (t) => ({
    uniq: uniqueIndex('mastery_user_concept_uniq').on(t.userId, t.conceptId),
  }),
);

export const conversation = pgTable(
  'conversation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    title: text('title'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index('conversation_user_created_idx').on(t.userId, t.createdAt),
  }),
);

export const message = pgTable(
  'message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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
    convCreatedIdx: index('message_conv_created_idx').on(t.conversationId, t.createdAt),
  }),
);

export const flashcard = pgTable(
  'flashcard',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    conceptId: text('concept_id').references(() => concept.id, { onDelete: 'set null' }),
    front: text('front').notNull(),
    back: text('back').notNull(),
    cardType: cardTypeEnum('card_type').notNull().default('BASIC'),
    sourceChunkId: text('source_chunk_id').references(() => chunk.id, {
      onDelete: 'set null',
    }),
    difficulty: real('difficulty').notNull().default(0),
    stability: real('stability').notNull().default(0),
    retrievability: real('retrievability').notNull().default(0),
    state: fsrsStateEnum('state').notNull().default('NEW'),
    due: timestamp('due').notNull().defaultNow(),
    lastReview: timestamp('last_review'),
  },
  (t) => ({
    userDueIdx: index('flashcard_user_due_idx').on(t.userId, t.due),
    userWorkspaceIdx: index('flashcard_user_workspace_idx').on(t.userId, t.workspaceId),
  }),
);

export const review = pgTable('review', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  flashcardId: text('flashcard_id')
    .notNull()
    .references(() => flashcard.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  duration: integer('duration').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const quiz = pgTable(
  'quiz',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    config: jsonb('config').$type<QuizConfig>().default({}).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userWorkspaceIdx: index('quiz_user_workspace_idx').on(t.userId, t.workspaceId),
  }),
);

export const question = pgTable('question', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  quizId: text('quiz_id')
    .notNull()
    .references(() => quiz.id, { onDelete: 'cascade' }),
  type: questionTypeEnum('type').notNull(),
  prompt: text('prompt').notNull(),
  options: jsonb('options').$type<string[] | null>(),
  correctAnswer: jsonb('correct_answer').notNull(),
  explanation: text('explanation').notNull(),
  conceptId: text('concept_id').references(() => concept.id, { onDelete: 'set null' }),
  difficulty: real('difficulty').notNull(),
});

export const quizAttempt = pgTable(
  'quiz_attempt',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quiz.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    submittedAt: timestamp('submitted_at'),
    score: real('score'),
    maxScore: real('max_score'),
    percentage: real('percentage'),
  },
  (t) => ({
    quizUserIdx: index('quiz_attempt_quiz_user_idx').on(t.quizId, t.userId),
    userIdx: index('quiz_attempt_user_idx').on(t.userId),
  }),
);

export const quizResponse = pgTable(
  'quiz_response',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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
    quickMarkerIdx: uniqueIndex('quiz_response_user_question_quick_idx')
      .on(t.userId, t.questionId)
      .where(sql`${t.attemptId} IS NULL`),
  }),
);

export const studySession = pgTable('study_session', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  sessionType: sessionTypeEnum('session_type').notNull(),
  metadata: jsonb('metadata').default({}).notNull(),
});

export const note = pgTable(
  'note',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
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

export const studyPlanStatusEnum = pgEnum('study_plan_status', ['PENDING', 'DONE', 'SKIPPED']);

export const studyPlanKindEnum = pgEnum('study_plan_kind', ['manual', 'review', 'new', 'practice']);

export const studyPlanItem = pgTable(
  'study_plan_item',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    conceptId: text('concept_id').references(() => concept.id, { onDelete: 'set null' }),
    status: studyPlanStatusEnum('status').notNull().default('PENDING'),
    kind: studyPlanKindEnum('kind').notNull().default('manual'),
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

export const userStats = pgTable(
  'user_stats',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    xp: integer('xp').notNull().default(0),
    currentStreak: integer('current_streak').notNull().default(0),
    longestStreak: integer('longest_streak').notNull().default(0),
    lastActivityDate: text('last_activity_date'),
    achievements: text('achievements')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    xpIdx: index('user_stats_xp_idx').on(t.xp),
  }),
);

export const studyGroup = pgTable(
  'study_group',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text('name').notNull(),
    description: text('description'),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    inviteCode: text('invite_code').notNull().unique(),
    iconUrl: text('icon_url'),
    bannerUrl: text('banner_url'),
    isPublic: boolean('is_public').notNull().default(false),
    maxMembers: integer('max_members').notNull().default(100),
    recordingLogChannelId: text('recording_log_channel_id'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendReason: text('suspend_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    inviteIdx: index('study_group_invite_idx').on(t.inviteCode),
  }),
);

export const groupRoleEnum = pgEnum('group_role', ['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER']);

export const studyGroupMember = pgTable(
  'study_group_member',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    groupId: text('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: groupRoleEnum('role').notNull().default('MEMBER'),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    nickname: text('nickname'),
    mutedUntil: timestamp('muted_until'),
    lastSeenAt: timestamp('last_seen_at'),
  },
  (t) => ({
    uniq: uniqueIndex('study_group_member_uniq').on(t.groupId, t.userId),
    userIdx: index('study_group_member_user_idx').on(t.userId),
  }),
);

export const dmThread = pgTable(
  'dm_thread',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    user1Id: text('user1_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    user2Id: text('user2_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
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
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    threadId: text('thread_id')
      .notNull()
      .references(() => dmThread.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    replyToId: text('reply_to_id'),
    attachments: jsonb('attachments').$type<
      Array<{
        type: 'image' | 'file' | 'audio' | 'video';
        url: string;
        name: string;
        size: number;
        mime: string;
      }>
    >(),
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

export const channelTypeEnum = pgEnum('channel_type', [
  'TEXT',
  'VOICE',
  'ANNOUNCEMENT',
  'STAGE',
  'FORUM',
]);

export const studyGroupCategory = pgTable(
  'study_group_category',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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

export const studyGroupChannel = pgTable(
  'study_group_channel',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    groupId: text('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: channelTypeEnum('type').notNull(),
    topic: text('topic'),
    position: integer('position').notNull().default(0),
    isPrivate: boolean('is_private').notNull().default(false),
    slowModeSeconds: integer('slow_mode_seconds'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    livekitRoomName: text('livekit_room_name'),
    voiceMaxParticipants: integer('voice_max_participants'),
    categoryId: text('category_id'),
    availableTags: jsonb('available_tags').$type<Array<{ name: string; color?: string }>>(),
  },
  (t) => ({
    groupPosIdx: index('study_group_channel_group_pos_idx').on(t.groupId, t.position),
    livekitIdx: uniqueIndex('study_group_channel_livekit_idx').on(t.livekitRoomName),
  }),
);

export const studyGroupMessage = pgTable(
  'study_group_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    channelId: text('channel_id')
      .notNull()
      .references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    contentType: text('content_type').notNull().default('markdown'),
    replyToId: text('reply_to_id'),
    attachments: jsonb('attachments').$type<
      Array<{
        type: 'image' | 'file' | 'audio' | 'video';
        url: string;
        name: string;
        size: number;
        mime: string;
      }>
    >(),
    reactions: jsonb('reactions').$type<Record<string, string[]>>(),
    pinned: boolean('pinned').notNull().default(false),
    mentions:
      jsonb('mentions').$type<Array<{ type: 'user' | 'channel' | 'everyone'; id: string }>>(),
    editedAt: timestamp('edited_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    threadRootId: text('thread_root_id'),
    threadCount: integer('thread_count').notNull().default(0),
    threadLastAt: timestamp('thread_last_at'),
    title: text('title'),
    tags: jsonb('tags').$type<string[]>(),
    isSolution: boolean('is_solution').notNull().default(false),
    archivedAt: timestamp('archived_at'),
  },
  (t) => ({
    channelTimeIdx: index('study_group_message_channel_time_idx').on(t.channelId, t.createdAt),
    authorIdx: index('study_group_message_author_idx').on(t.authorId),
    threadIdx: index('study_group_message_thread_idx').on(t.threadRootId, t.createdAt),
  }),
);

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
    muted: boolean('muted').notNull().default(false),
    notificationSetting: text('notification_setting').notNull().default('all'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.channelId] }),
  }),
);

export const studyGroupMessageRevision = pgTable(
  'study_group_message_revision',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    messageId: text('message_id')
      .notNull()
      .references(() => studyGroupMessage.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    editedAt: timestamp('edited_at').notNull().defaultNow(),
  },
  (t) => ({
    msgIdx: index('study_group_message_revision_msg_idx').on(t.messageId, t.editedAt),
  }),
);

export const studyGroupRole = pgTable(
  'study_group_role',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    groupId: text('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#9aa3af'),
    position: integer('position').notNull().default(0),
    permissions: jsonb('permissions').notNull().default({}),
    hoisted: boolean('hoisted').notNull().default(false),
    mentionable: boolean('mentionable').notNull().default(false),
    isManaged: boolean('is_managed').notNull().default(false),
    legacyRole: text('legacy_role'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    groupPositionIdx: index('study_group_role_group_position_idx').on(t.groupId, t.position),
    groupNameUniq: uniqueIndex('study_group_role_group_name_uniq').on(t.groupId, t.name),
  }),
);

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

export const studyGroupChannelPermission = pgTable(
  'study_group_channel_permission',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    channelId: text('channel_id')
      .notNull()
      .references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    roleId: text('role_id').references(() => studyGroupRole.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
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

export const studyGroupInvite = pgTable(
  'study_group_invite',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    groupId: text('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    code: text('code').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    maxUses: integer('max_uses'),
    usesCount: integer('uses_count').notNull().default(0),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    groupIdx: index('study_group_invite_group_idx').on(t.groupId),
  }),
);

export const studyGroupStageRole = pgTable(
  'study_group_stage_role',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('AUDIENCE'),
    raisedAt: timestamp('raised_at'),
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
    selfMuted: boolean('self_muted').notNull().default(false),
    serverMuted: boolean('server_muted').notNull().default(false),
    camera: boolean('camera').notNull().default(false),
    screenShare: boolean('screen_share').notNull().default(false),
  },
  (t) => ({
    channelIdx: index('study_group_voice_state_channel_idx').on(t.channelId),
  }),
);

export const room = pgTable(
  'room',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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

export const roomMember = pgTable(
  'room_member',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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

export const roomMessage = pgTable(
  'room_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    roomId: text('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    content: text('content').notNull(),
    type: text('type').notNull().default('TEXT'),
    metadata: jsonb('metadata'),
    replyToId: text('reply_to_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    roomTimeIdx: index('room_message_room_time_idx').on(t.roomId, t.createdAt),
  }),
);

export const roomEvent = pgTable(
  'room_event',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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

export const recording = pgTable(
  'recording',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    roomId: text('room_id').references(() => room.id, { onDelete: 'cascade' }),
    studyGroupChannelId: text('study_group_channel_id').references(() => studyGroupChannel.id, {
      onDelete: 'cascade',
    }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    egressId: text('egress_id').unique(),
    storageKey: text('storage_key'),
    fileUrl: text('file_url'),
    duration: integer('duration_seconds'),
    fileSize: integer('file_size_bytes'),
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

export const collabDoc = pgTable('collab_doc', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  state: text('state').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    actorId: text('actor_id'),
    actorType: text('actor_type').notNull(),
    action: text('action').notNull(),
    result: text('result').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    traceId: text('trace_id'),
    metadata: jsonb('metadata'),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
  },
  (t) => ({
    actorTimeIdx: index('audit_log_actor_time_idx').on(t.actorId, t.timestamp),
    actionTimeIdx: index('audit_log_action_time_idx').on(t.action, t.timestamp),
    resourceIdx: index('audit_log_resource_idx').on(t.resourceType, t.resourceId),
  }),
);

export const deletionRequest = pgTable('deletion_request', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text('user_id').notNull(),
  status: text('status').notNull().default('PENDING'),
  reason: text('reason'),
  scheduledFor: timestamp('scheduled_for').notNull(),
  completedAt: timestamp('completed_at'),
  errorMessage: text('error_message'),
  requestedAt: timestamp('requested_at').notNull().defaultNow(),
});

export const pushToken = pgTable(
  'push_token',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    platform: text('platform').notNull(),
    deviceId: text('device_id'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('push_token_user_idx').on(t.userId),
    tokenIdx: uniqueIndex('push_token_token_idx').on(t.token),
  }),
);

export const notificationLog = pgTable(
  'notification_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data'),
    status: text('status').notNull().default('pending'),
    receiptId: text('receipt_id'),
    error: text('error'),
    sentAt: timestamp('sent_at'),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userTypeIdx: index('notification_log_user_type_idx').on(t.userId, t.type, t.createdAt),
  }),
);

export const examModeEnum = pgEnum('exam_mode', [
  'PRACTICE',
  'TIMED',
  'LIVE',
  'ASYNC',
  'ADAPTIVE',
  'TOURNAMENT',
]);

export const examStatusEnum = pgEnum('exam_status', ['DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'ENDED']);

export const attemptStatusEnum = pgEnum('attempt_status', [
  'IN_PROGRESS',
  'SUBMITTED',
  'TIMED_OUT',
  'AUTO_SUBMITTED',
  'DISQUALIFIED',
]);

export const exam = pgTable(
  'exam',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    mode: examModeEnum('mode').notNull().default('PRACTICE'),
    status: examStatusEnum('status').notNull().default('DRAFT'),

    durationSeconds: integer('duration_seconds'),
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),

    passingScore: real('passing_score'),
    maxScore: real('max_score').notNull().default(0),
    showResults: text('show_results').notNull().default('IMMEDIATE'),

    shuffleQuestions: boolean('shuffle_questions').notNull().default(true),
    shuffleOptions: boolean('shuffle_options').notNull().default(true),
    allowReview: boolean('allow_review').notNull().default(true),
    maxAttempts: integer('max_attempts').notNull().default(1),

    liveCode: text('live_code').unique(),
    currentQuestionIndex: integer('current_question_index'),

    minQuestions: integer('min_questions').default(10),
    maxQuestions: integer('max_questions').default(30),
    targetSE: real('target_se').default(0.3),

    antiCheat: jsonb('anti_cheat')
      .$type<{
        requireFullscreen?: boolean;
        blockTabSwitch?: boolean;
        blockCopyPaste?: boolean;
        blockContextMenu?: boolean;
        detectDevtools?: boolean;
        requireWebcam?: boolean;
        requireMic?: boolean;
        aiProctor?: boolean;
      }>()
      .default({}),

    classroomId: text('classroom_id'),
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

export const examQuestion = pgTable(
  'exam_question',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    examId: text('exam_id')
      .notNull()
      .references(() => exam.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),

    prompt: text('prompt').notNull(),
    promptHtml: text('prompt_html'),
    attachments: jsonb('attachments').$type<Array<{ type: string; url: string; alt?: string }>>(),

    options: jsonb('options').$type<string[] | Record<string, string> | null>(),
    correctAnswer: jsonb('correct_answer'),
    acceptableAnswers: jsonb('acceptable_answers').$type<string[] | null>(),
    rubric: jsonb('rubric'),
    testCases: jsonb('test_cases'),

    points: real('points').notNull().default(1),
    partialCredit: boolean('partial_credit').notNull().default(false),

    difficulty: real('difficulty').notNull().default(0),
    discrimination: real('discrimination').notNull().default(1),
    guessing: real('guessing').notNull().default(0),

    conceptId: text('concept_id').references(() => concept.id, { onDelete: 'set null' }),
    explanation: text('explanation'),
    hint: text('hint'),
    timeLimitSeconds: integer('time_limit_seconds'),
    orderIndex: integer('order_index').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    examOrderIdx: index('exam_question_exam_order_idx').on(t.examId, t.orderIndex),
  }),
);

export const examAttempt = pgTable(
  'exam_attempt',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    examId: text('exam_id')
      .notNull()
      .references(() => exam.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: attemptStatusEnum('status').notNull().default('IN_PROGRESS'),

    startedAt: timestamp('started_at').notNull().defaultNow(),
    submittedAt: timestamp('submitted_at'),

    score: real('score'),
    maxScore: real('max_score'),
    percentage: real('percentage'),
    passed: boolean('passed'),

    estimatedTheta: real('estimated_theta'),
    thetaSE: real('theta_se'),

    timeSpentSeconds: integer('time_spent_seconds'),
    questionsAnswered: integer('questions_answered').notNull().default(0),

    violations:
      jsonb('violations').$type<Array<{ type: string; timestamp: string; metadata?: unknown }>>(),
    cheatRiskScore: real('cheat_risk_score'),
    flagged: boolean('flagged').notNull().default(false),
    flagReason: text('flag_reason'),

    webcamRecordingUrl: text('webcam_recording_url'),
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

export const examResponse = pgTable(
  'exam_response',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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
    responseTimeMs: integer('response_time_ms'),
    rankAtSubmit: integer('rank_at_submit'),

    aiGrading: jsonb('ai_grading'),
    manualGrading: jsonb('manual_grading'),
    needsReview: boolean('needs_review').notNull().default(false),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    attemptQuestionIdx: uniqueIndex('exam_response_attempt_question_idx').on(
      t.attemptId,
      t.questionId,
    ),
  }),
);

export const examViolation = pgTable(
  'exam_violation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => examAttempt.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    severity: text('severity').notNull(),
    metadata: jsonb('metadata'),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
  },
  (t) => ({
    attemptIdx: index('exam_violation_attempt_idx').on(t.attemptId),
  }),
);

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

export const tutorProfile = pgTable(
  'tutor_profile',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: 'cascade' }),
    headline: text('headline').notNull(),
    bio: text('bio').notNull(),
    hourlyRateVnd: integer('hourly_rate_vnd').notNull(),
    modality: text('modality').notNull().default('ONLINE'),
    avatarUrl: text('avatar_url'),
    bannerUrl: text('banner_url'),
    sessionsCompleted: integer('sessions_completed').notNull().default(0),
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
    ratingCount: integer('rating_count').notNull().default(0),
    verificationStatus: text('verification_status').notNull().default('NONE'),
    bioEmbedding: vector('bio_embedding', 1024),
    bioEmbeddingUpdatedAt: timestamp('bio_embedding_updated_at'),
    instantBookEnabled: boolean('instant_book_enabled').notNull().default(false),
    trialSessionEnabled: boolean('trial_session_enabled').notNull().default(true),
    avgResponseMinutes: integer('avg_response_minutes'),
    responseRatePct: integer('response_rate_pct'),
    icalToken: text('ical_token'),
    introVideoUrl: text('intro_video_url'),
    introVideoThumbUrl: text('intro_video_thumb_url'),
    status: text('status').notNull().default('DRAFT'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('tutor_profile_status_idx').on(t.status),
    modalityIdx: index('tutor_profile_modality_idx').on(t.modality, t.status),
  }),
);

export const tutoringConciergeThread = pgTable(
  'tutoring_concierge_thread',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title'),
    lastMessageAt: timestamp('last_message_at').notNull().defaultNow(),
    extractedFilters: jsonb('extracted_filters').$type<{
      subjectSlug?: string;
      level?: string;
      budgetMaxVnd?: number;
      modality?: string;
      city?: string;
      keywords?: string[];
    }>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userTimeIdx: index('tutoring_concierge_thread_user_time_idx').on(t.userId, t.lastMessageAt),
  }),
);

export const tutoringConciergeMessage = pgTable(
  'tutoring_concierge_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    threadId: text('thread_id')
      .notNull()
      .references(() => tutoringConciergeThread.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').$type<{
      action?: 'search' | 'clarify';
      tutorIds?: string[];
      filters?: Record<string, unknown>;
      total?: number;
    }>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    threadTimeIdx: index('tutoring_concierge_message_thread_time_idx').on(t.threadId, t.createdAt),
  }),
);

export type TutoringConciergeThread = typeof tutoringConciergeThread.$inferSelect;
export type TutoringConciergeMessage = typeof tutoringConciergeMessage.$inferSelect;

export const tutorSubject = pgTable(
  'tutor_subject',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    subjectSlug: text('subject_slug').notNull(),
    level: text('level').notNull(),
    verifiedAt: timestamp('verified_at'),
    verifyScore: integer('verify_score'),
  },
  (t) => ({
    uniq: uniqueIndex('tutor_subject_uniq').on(t.tutorId, t.subjectSlug, t.level),
    subjectIdx: index('tutor_subject_subject_idx').on(t.subjectSlug, t.level),
  }),
);

export const tutorAvailability = pgTable(
  'tutor_availability',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    timezone: text('timezone').notNull().default('Asia/Ho_Chi_Minh'),
  },
  (t) => ({
    tutorIdx: index('tutor_availability_tutor_idx').on(t.tutorId),
  }),
);

export const tutorRequest = pgTable(
  'tutor_request',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    subjectSlug: text('subject_slug').notNull(),
    level: text('level').notNull(),
    budgetVnd: integer('budget_vnd'),
    modality: text('modality').notNull().default('ONLINE'),
    urgency: text('urgency').notNull().default('FLEXIBLE'),
    status: text('status').notNull().default('OPEN'),
    embedding: vector('embedding', 1024),
    embeddingUpdatedAt: timestamp('embedding_updated_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
  },
  (t) => ({
    subjectIdx: index('tutor_request_subject_idx').on(t.subjectSlug, t.level, t.status),
    studentIdx: index('tutor_request_student_idx').on(t.studentId, t.createdAt),
  }),
);

export const tutorApplication = pgTable(
  'tutor_application',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    requestId: text('request_id')
      .notNull()
      .references(() => tutorRequest.id, { onDelete: 'cascade' }),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    proposedRateVnd: integer('proposed_rate_vnd').notNull(),
    status: text('status').notNull().default('PENDING'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('tutor_application_uniq').on(t.requestId, t.tutorId),
    tutorIdx: index('tutor_application_tutor_idx').on(t.tutorId, t.createdAt),
  }),
);

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

export const tutoringBooking = pgTable(
  'tutoring_booking',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'restrict' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    studyGroupId: text('study_group_id').references(() => studyGroup.id, {
      onDelete: 'set null',
    }),
    subjectSlug: text('subject_slug').notNull(),
    level: text('level').notNull(),
    startAt: timestamp('start_at').notNull(),
    endAt: timestamp('end_at').notNull(),
    rateVnd: integer('rate_vnd').notNull(),
    status: text('status').notNull().default('PENDING_TUTOR'),
    studentMessage: text('student_message'),
    sessionNotes: text('session_notes'),
    recordingId: text('recording_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at'),
    completedAt: timestamp('completed_at'),
    cancelledAt: timestamp('cancelled_at'),
    cancelledBy: text('cancelled_by'),
    cancelReason: text('cancel_reason'),
    isTrial: boolean('is_trial').notNull().default(false),
    originalStartAt: timestamp('original_start_at'),
    rescheduleCount: integer('reschedule_count').notNull().default(0),
    packPurchaseId: text('pack_purchase_id'),
  },
  (t) => ({
    tutorTimeIdx: index('tutoring_booking_tutor_time_idx').on(t.tutorId, t.startAt),
    studentTimeIdx: index('tutoring_booking_student_time_idx').on(t.studentId, t.startAt),
    statusIdx: index('tutoring_booking_status_idx').on(t.status),
  }),
);

export const tutorReview = pgTable('tutor_review', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
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
  rating: integer('rating').notNull(),
  comment: text('comment'),
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  hiddenReason: text('hidden_reason'),
  hiddenBy: text('hidden_by').references(() => user.id, { onDelete: 'set null' }),
  tags: text('tags')
    .array()
    .default(sql`'{}'::text[]`),
  helpfulCount: integer('helpful_count').notNull().default(0),
  attachments: jsonb('attachments').$type<
    Array<{
      type: 'image' | 'video';
      url: string;
      thumbUrl?: string;
    }>
  >(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

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

export const tutorKycDocument = pgTable(
  'tutor_kyc_document',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    docType: text('doc_type').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    originalName: text('original_name').notNull(),
    status: text('status').notNull().default('PENDING'),
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

export const tutorSubjectVerifyQuiz = pgTable(
  'tutor_subject_verify_quiz',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tutorSubjectId: text('tutor_subject_id')
      .notNull()
      .references(() => tutorSubject.id, { onDelete: 'cascade' }),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quiz.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('PENDING'),
    score: integer('score'),
    passThreshold: integer('pass_threshold').notNull().default(80),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (t) => ({
    subjectIdx: index('tutor_subject_verify_quiz_subject_idx').on(t.tutorSubjectId),
  }),
);

export const tutoringPayment = pgTable(
  'tutoring_payment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    bookingId: text('booking_id')
      .notNull()
      .unique()
      .references(() => tutoringBooking.id, { onDelete: 'restrict' }),
    amountVnd: integer('amount_vnd').notNull(),
    feeVnd: integer('fee_vnd').notNull().default(0),
    provider: text('provider').notNull().default('STUB'),
    providerRef: text('provider_ref'),
    orderCode: text('order_code').notNull().unique(),
    status: text('status').notNull().default('CREATED'),
    escrowReleaseAt: timestamp('escrow_release_at'),
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

export const tutorPayout = pgTable(
  'tutor_payout',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'restrict' }),
    amountVnd: integer('amount_vnd').notNull(),
    status: text('status').notNull().default('REQUESTED'),
    method: text('method').notNull().default('BANK_TRANSFER'),
    accountDetails: jsonb('account_details').$type<{
      bankName?: string;
      accountNumber?: string;
      accountHolder?: string;
      phone?: string;
    }>(),
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

export const tutorSubjectVerifyQuizRelations = relations(tutorSubjectVerifyQuiz, ({ one }) => ({
  subject: one(tutorSubject, {
    fields: [tutorSubjectVerifyQuiz.tutorSubjectId],
    references: [tutorSubject.id],
  }),
  quiz: one(quiz, {
    fields: [tutorSubjectVerifyQuiz.quizId],
    references: [quiz.id],
  }),
}));

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

export const userWallet = pgTable('user_wallet', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  balanceVnd: integer('balance_vnd').notNull().default(0),
  promoBalanceVnd: integer('promo_balance_vnd').notNull().default(0),
  promoExpiresAt: timestamp('promo_expires_at'),
  autoTopupThresholdVnd: integer('auto_topup_threshold_vnd'),
  autoTopupAmountVnd: integer('auto_topup_amount_vnd'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const userWalletTxn = pgTable(
  'user_wallet_txn',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    amountVnd: integer('amount_vnd').notNull(),
    balanceAfterVnd: integer('balance_after_vnd').notNull(),
    relatedId: text('related_id'),
    relatedType: text('related_type'),
    description: text('description'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userTimeIdx: index('user_wallet_txn_user_time_idx').on(t.userId, t.createdAt),
  }),
);

export const tutoringPack = pgTable(
  'tutoring_pack',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    subjectSlug: text('subject_slug').notNull(),
    level: text('level').notNull(),
    sessionCount: integer('session_count').notNull(),
    durationMin: integer('duration_min').notNull().default(60),
    ratePerSessionVnd: integer('rate_per_session_vnd').notNull(),
    totalVnd: integer('total_vnd').notNull(),
    discountPct: integer('discount_pct').notNull().default(0),
    status: text('status').notNull().default('ACTIVE'),
    description: text('description'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tutorIdx: index('tutoring_pack_tutor_idx').on(t.tutorId, t.status),
  }),
);

export const tutoringPackPurchase = pgTable(
  'tutoring_pack_purchase',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    packId: text('pack_id')
      .notNull()
      .references(() => tutoringPack.id, { onDelete: 'restrict' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    totalVnd: integer('total_vnd').notNull(),
    remainingSessions: integer('remaining_sessions').notNull(),
    installmentTotalPeriods: integer('installment_total_periods'),
    installmentPaidPeriods: integer('installment_paid_periods').notNull().default(0),
    recurringSchedule: text('recurring_schedule'),
    status: text('status').notNull().default('ACTIVE'),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    studentIdx: index('tutoring_pack_purchase_student_idx').on(t.studentId, t.status),
  }),
);

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

export const promoCodeRedemption = pgTable(
  'promo_code_redemption',
  {
    promoCode: text('promo_code')
      .notNull()
      .references(() => promoCode.code, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    amountVnd: integer('amount_vnd').notNull().default(0),
    redeemedAt: timestamp('redeemed_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.promoCode, t.userId] }),
  }),
);

export type UserWallet = typeof userWallet.$inferSelect;
export type UserWalletTxn = typeof userWalletTxn.$inferSelect;
export type TutoringPack = typeof tutoringPack.$inferSelect;
export type TutoringPackPurchase = typeof tutoringPackPurchase.$inferSelect;
export type PromoCode = typeof promoCode.$inferSelect;

export const tutoringClass = pgTable(
  'tutoring_class',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    subjectSlug: text('subject_slug').notNull(),
    level: text('level').notNull(),
    maxStudents: integer('max_students').notNull(),
    enrolledCount: integer('enrolled_count').notNull().default(0),
    ratePerStudentVnd: integer('rate_per_student_vnd').notNull(),
    durationMin: integer('duration_min').notNull().default(90),
    totalSessions: integer('total_sessions').notNull().default(1),
    scheduleType: text('schedule_type').notNull(),
    scheduleSlots: jsonb('schedule_slots').$type<string[]>().notNull(),
    startDate: date('start_date').notNull(),
    studyGroupId: text('study_group_id').references(() => studyGroup.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('OPEN'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('tutoring_class_status_idx').on(t.status, t.startDate),
    tutorIdx: index('tutoring_class_tutor_idx').on(t.tutorId, t.status),
  }),
);

export const tutoringClassEnrollment = pgTable(
  'tutoring_class_enrollment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    classId: text('class_id')
      .notNull()
      .references(() => tutoringClass.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('ENROLLED'),
    paymentId: text('payment_id'),
    enrolledAt: timestamp('enrolled_at').notNull().defaultNow(),
  },
  (t) => ({
    classIdx: index('tutoring_class_enrollment_class_idx').on(t.classId, t.status),
    studentIdx: index('tutoring_class_enrollment_student_idx').on(t.studentId, t.status),
    unique: uniqueIndex('tutoring_class_enrollment_uniq').on(t.classId, t.studentId),
  }),
);

export const tutorBlockedTime = pgTable(
  'tutor_blocked_time',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    startAt: timestamp('start_at').notNull(),
    endAt: timestamp('end_at').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    tutorIdx: index('tutor_blocked_time_tutor_idx').on(t.tutorId, t.startAt),
  }),
);

export type TutoringClass = typeof tutoringClass.$inferSelect;
export type TutoringClassEnrollment = typeof tutoringClassEnrollment.$inferSelect;
export type TutorBlockedTime = typeof tutorBlockedTime.$inferSelect;

export const tutorReviewHelpful = pgTable(
  'tutor_review_helpful',
  {
    reviewId: text('review_id')
      .notNull()
      .references(() => tutorReview.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.reviewId, t.userId] }),
  }),
);

export const tutorFavorite = pgTable(
  'tutor_favorite',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.tutorId] }),
    userIdx: index('tutor_favorite_user_idx').on(t.userId, t.createdAt),
  }),
);

export const tutorSavedSearch = pgTable(
  'tutor_saved_search',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filters: jsonb('filters')
      .$type<{
        subjectSlug?: string;
        level?: string;
        budgetMaxVnd?: number;
        modality?: string;
        keywords?: string[];
      }>()
      .notNull(),
    alertEnabled: boolean('alert_enabled').notNull().default(false),
    lastNotifiedAt: timestamp('last_notified_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('tutor_saved_search_user_idx').on(t.userId),
  }),
);

export type TutorReviewHelpful = typeof tutorReviewHelpful.$inferSelect;
export type TutorFavorite = typeof tutorFavorite.$inferSelect;
export type TutorSavedSearch = typeof tutorSavedSearch.$inferSelect;

export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    adminId: text('admin_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
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
    resolution: text('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    targetIdx: index('idx_report_target').on(t.targetType, t.targetId),
  }),
);

export const systemConfig = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiUsageLog = pgTable(
  'ai_usage_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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

export type DmThread = typeof dmThread.$inferSelect;
export type NewDmThread = typeof dmThread.$inferInsert;
export type DmMessage = typeof dmMessage.$inferSelect;
export type NewDmMessage = typeof dmMessage.$inferInsert;

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

export type TutoringBooking = typeof tutoringBooking.$inferSelect;
export type NewTutoringBooking = typeof tutoringBooking.$inferInsert;
export type TutorReview = typeof tutorReview.$inferSelect;
export type NewTutorReview = typeof tutorReview.$inferInsert;

export type TutorKycDocument = typeof tutorKycDocument.$inferSelect;
export type NewTutorKycDocument = typeof tutorKycDocument.$inferInsert;
export type TutorSubjectVerifyQuiz = typeof tutorSubjectVerifyQuiz.$inferSelect;
export type NewTutorSubjectVerifyQuiz = typeof tutorSubjectVerifyQuiz.$inferInsert;
export type TutoringPayment = typeof tutoringPayment.$inferSelect;
export type NewTutoringPayment = typeof tutoringPayment.$inferInsert;
export type TutorPayout = typeof tutorPayout.$inferSelect;
export type NewTutorPayout = typeof tutorPayout.$inferInsert;

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT';
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLog.$inferInsert;
export type ContentReport = typeof contentReport.$inferSelect;
export type NewContentReport = typeof contentReport.$inferInsert;
export type SystemConfig = typeof systemConfig.$inferSelect;
export type NewSystemConfig = typeof systemConfig.$inferInsert;

export const libraryDoc = pgTable(
  'library_doc',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    uploaderId: text('uploader_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    description: text('description'),
    subjectSlug: text('subject_slug').notNull(),
    level: text('level').notNull(),
    grade: integer('grade'),
    docType: text('doc_type').notNull().default('other'),
    examType: text('exam_type'),
    schoolYear: text('school_year'),
    region: text('region').default('national'),
    language: text('language').default('vi'),
    tags: text('tags')
      .array()
      .default(sql`'{}'::text[]`),
    difficulty: text('difficulty'),
    prerequisiteAtomSlugs: text('prerequisite_atom_slugs')
      .array()
      .default(sql`'{}'::text[]`),

    fileFormat: text('file_format').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    fileUrl: text('file_url').notNull(),
    fileHash: text('file_hash').notNull(),
    pageCount: integer('page_count'),

    previewThumbUrl: text('preview_thumb_url'),
    aiSummary: text('ai_summary'),
    aiSummaryAt: timestamp('ai_summary_at'),
    previewText: text('preview_text'),

    titleEmbedding: vector('title_embedding', 1024),

    license: text('license').default('CC-BY-4.0'),
    status: text('status').notNull().default('PROCESSING'),
    hiddenAt: timestamp('hidden_at'),
    hiddenReason: text('hidden_reason'),

    viewCount: integer('view_count').notNull().default(0),
    downloadCount: integer('download_count').notNull().default(0),
    workspaceImportCount: integer('workspace_import_count').notNull().default(0),
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
    ratingCount: integer('rating_count').notNull().default(0),

    qualityScore: numeric('quality_score', { precision: 5, scale: 2 }),
    qualityBreakdown: jsonb('quality_breakdown'),
    badges: text('badges')
      .array()
      .default(sql`'{}'::text[]`),

    parentRemixDocIds: text('parent_remix_doc_ids')
      .array()
      .default(sql`'{}'::text[]`),
    remixCount: integer('remix_count').notNull().default(0),

    isPremium: boolean('is_premium').notNull().default(false),
    priceVnd: integer('price_vnd'),
    creatorSharePct: integer('creator_share_pct').notNull().default(80),

    courseId: text('course_id').references((): AnyPgColumn => libraryCourse.id, {
      onDelete: 'set null',
    }),
    universityId: text('university_id').references((): AnyPgColumn => libraryUniversity.id, {
      onDelete: 'set null',
    }),
    courseNameCache: text('course_name_cache'),
    universityNameCache: text('university_name_cache'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    subjectGradeIdx: index('library_doc_subject_grade_idx').on(t.subjectSlug, t.grade, t.status),
    subjectLevelIdx: index('library_doc_subject_level_idx').on(t.subjectSlug, t.level, t.status),
    typeIdx: index('library_doc_type_idx').on(t.docType, t.status),
    uploaderIdx: index('library_doc_uploader_idx').on(t.uploaderId),
    courseIdx: index('library_doc_course_idx').on(t.courseId, t.status),
    universityIdx: index('library_doc_university_idx').on(t.universityId, t.status),
  }),
);

export const libraryUniversity = pgTable('library_university', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  shortName: text('short_name'),
  country: text('country').notNull().default('VN'),
  logoUrl: text('logo_url'),
  docCount: integer('doc_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const libraryCourse = pgTable(
  'library_course',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    universityId: text('university_id').references(() => libraryUniversity.id, {
      onDelete: 'set null',
    }),
    code: text('code'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
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

export const libraryDocChunk = pgTable(
  'library_doc_chunk',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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

export const libraryDocAtom = pgTable(
  'library_doc_atom',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    atomText: text('atom_text').notNull(),
    atomSlug: text('atom_slug').notNull(),
    pageNums: integer('page_nums').array().notNull(),
    difficulty: text('difficulty'),
    embedding: vector('embedding', 1024),
  },
  (t) => ({
    slugIdx: index('library_doc_atom_slug_idx').on(t.atomSlug),
    docIdx: index('library_doc_atom_doc_idx').on(t.docId),
  }),
);

export const libraryDocReview = pgTable(
  'library_doc_review',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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

export const libraryDocImport = pgTable(
  'library_doc_import',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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
    userIdx: index('library_doc_import_user_idx').on(t.importerId, t.importedAt),
  }),
);

export const libraryDocOutcome = pgTable(
  'library_doc_outcome',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
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

export const libraryDocReport = pgTable(
  'library_doc_report',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => user.id),
    reason: text('reason').notNull(),
    detail: text('detail'),
    status: text('status').notNull().default('PENDING'),
    adminId: text('admin_id').references(() => user.id),
    actionedAt: timestamp('actioned_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('library_doc_report_status_idx').on(t.status, t.createdAt),
  }),
);

export const libraryDocAnnotation = pgTable(
  'library_doc_annotation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    pageNum: integer('page_num').notNull(),
    note: text('note').notNull(),
    selectedText: text('selected_text'),
    selectionRect: jsonb('selection_rect').$type<{
      pageW: number;
      pageH: number;
      x: number;
      y: number;
      w: number;
      h: number;
    }>(),
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

export const librarySavedSearch = pgTable(
  'library_saved_search',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    queryParams: jsonb('query_params')
      .$type<Record<string, string | number | string[]>>()
      .notNull(),
    notifyOnNew: boolean('notify_on_new').notNull().default(false),
    lastRunAt: timestamp('last_run_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('library_saved_search_user_idx').on(t.userId, t.createdAt),
  }),
);

export const libraryDocView = pgTable(
  'library_doc_view',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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

export const libraryDocPurchase = pgTable(
  'library_doc_purchase',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    priceVnd: integer('price_vnd').notNull(),
    creatorShareVnd: integer('creator_share_vnd').notNull(),
    platformShareVnd: integer('platform_share_vnd').notNull(),
    walletTxnId: text('wallet_txn_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('library_doc_purchase_unique').on(t.docId, t.buyerId),
    buyerIdx: index('library_doc_purchase_buyer_idx').on(t.buyerId, t.createdAt),
    docIdx: index('library_doc_purchase_doc_idx').on(t.docId, t.createdAt),
  }),
);

export const libraryCreatorKarma = pgTable(
  'library_creator_karma',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    points: integer('points').notNull().default(0),
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
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
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
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
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

export const libraryDocEndorsement = pgTable(
  'library_doc_endorsement',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    docId: text('doc_id')
      .notNull()
      .references(() => libraryDoc.id, { onDelete: 'cascade' }),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfile.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('library_doc_endorsement_uniq').on(t.docId, t.tutorId),
    docIdx: index('library_doc_endorsement_doc_idx').on(t.docId, t.createdAt),
    tutorIdx: index('library_doc_endorsement_tutor_idx').on(t.tutorId, t.createdAt),
  }),
);

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
