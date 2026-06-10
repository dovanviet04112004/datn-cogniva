/**
 * Domain types share giữa web + mobile.
 *
 * NGUYÊN TẮC: types ở đây là API DTO (request/response), KHÔNG phải DB row.
 * DB row types ở @cogniva/db chỉ web import (mobile không direct DB).
 *
 * Mobile dùng API client (`@cogniva/shared/api`) gọi REST endpoint → nhận DTO
 * → render. KHÔNG có pgvector, KHÔNG có Drizzle InferSelectModel ở đây.
 */

// ── User & session ─────────────────────────────────────────────────
export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  plan: 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';
  emailVerified: boolean;
  parentalConsentStatus: 'NOT_REQUIRED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  createdAt: string; // ISO
}

/**
 * Session response từ Better Auth /api/auth/get-session.
 * Lưu ý: endpoint có thể trả `null` khi không có session — caller phải guard.
 * `session` chứa metadata (id, expiresAt) + `user` riêng (Better Auth shape v1.x).
 */
export interface SessionDTO {
  session: {
    id: string;
    userId: string;
    expiresAt: string;
    token: string;
  };
  user: UserDTO;
}

// ── Document (match real backend shape) ────────────────────────────
export interface DocumentDTO {
  id: string;
  filename: string;
  mimeType: string;
  size: number;       // bytes
  pageCount: number | null;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  createdAt: string;
  chunks: number;     // số chunk đã ingest (tự backend join chunk_count)
}

// ── Flashcard (match real backend $inferSelect shape) ──────────────
export interface FlashcardDTO {
  id: string;
  userId: string;
  conceptId: string | null;
  sourceChunkId: string | null;
  front: string;
  back: string;
  due: string; // ISO
  state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
  cardType: 'BASIC' | 'CLOZE' | 'IMAGE_OCCLUSION';
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  createdAt: string;
}

export interface ReviewDTO {
  id: string;
  flashcardId: string;
  rating: 1 | 2 | 3 | 4;
  reviewedAt: string;
  elapsedDays: number;
  scheduledDays: number;
}

// ── Note ───────────────────────────────────────────────────────────
export interface NoteDTO {
  id: string;
  title: string;
  content: string;
  workspaceId?: string | null;
  createdAt?: string; // ISO
  updatedAt?: string; // ISO
}

// ── Public profile (Wave 2) ────────────────────────────────────────
export interface AchievementMetaDTO {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export interface PublicProfileDTO {
  user: {
    id: string;
    name: string | null;
    image: string | null;
    plan: string;
    createdAt: string;
  };
  stats: {
    xp: number;
    currentStreak: number;
    longestStreak: number;
    achievements: string[];
  };
  achievementMeta: AchievementMetaDTO[];
}

// ── Graph concept detail (Wave 2) ──────────────────────────────────
export interface ConceptDetailDTO {
  concept: {
    id: string;
    name: string;
    description: string | null;
    domain: string;
  };
  chunks: Array<{
    id: string;
    snippet: string;
    documentId: string;
    filename: string;
    page: number | null;
    strength: number;
  }>;
}

// ── Quiz attempt (Wave 3) ──────────────────────────────────────────
export interface QuizQuestionDTO {
  id: string;
  type: 'MCQ' | 'TRUE_FALSE' | 'SHORT';
  prompt: string;
  options: string[] | null;
  difficulty: number;
}

export interface QuizAttemptDTO {
  quiz: { id: string; title: string };
  questions: QuizQuestionDTO[];
}

// ── Workspace manage (quản trị flashcard + câu hỏi) ─────────────────
// Khớp /api/workspaces/[id]/manage. "done" = đã làm/đã ôn.
export interface ManageFlashcardDTO {
  id: string;
  front: string;
  back: string;
  cardType: 'BASIC' | 'CLOZE' | 'IMAGE_OCCLUSION';
  state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
  due: string | null;
  lastReview: string | null;
  atomName: string | null;
  /** Đã ôn (lastReview != null). */
  done: boolean;
}

export interface ManageQuestionDTO {
  id: string;
  prompt: string;
  type: 'MCQ' | 'TRUE_FALSE' | 'SHORT' | 'ESSAY' | 'FILL_BLANK';
  quizTitle: string | null;
  atomName: string | null;
  /** Đã làm (có quiz_response của user). */
  done: boolean;
  /** Đúng/sai lần gần nhất (null nếu chưa làm). */
  lastCorrect: boolean | null;
  answeredAt: string | null;
}

export interface WorkspaceManageDTO {
  flashcards: ManageFlashcardDTO[];
  questions: ManageQuestionDTO[];
}

// ── Mastery ────────────────────────────────────────────────────────
export interface MasteryDTO {
  userId: string;
  conceptId: string;
  conceptName: string;
  level: number; // 0..1
  reviewCount: number;
  lastReviewAt: string | null;
}

// ── Chat ───────────────────────────────────────────────────────────
export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: {
    citations?: Array<{ documentId: string; chunkId: string; page?: number }>;
    provider?: string;
    cacheHit?: boolean;
  };
  createdAt: string;
}

// ── Usage / quota ──────────────────────────────────────────────────
// Khớp với /api/account/usage backend (apps/web/src/app/api/account/usage/route.ts).
export interface UsageDTO {
  plan: UserDTO['plan'];
  spentUsd: number;       // đã dùng hôm nay
  quotaUsd: number;       // quota daily
  remainingUsd: number;
  resetAt: string;        // ISO 00:00 UTC kế tiếp
  spentPct: number;       // 0..100
}

// ── API envelope ───────────────────────────────────────────────────
export interface ApiError {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };
