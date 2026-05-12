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
