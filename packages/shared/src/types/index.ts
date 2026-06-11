export type SearchResult = {
  type: 'document' | 'concept' | 'flashcard' | 'quiz' | 'note';
  id: string;
  label: string;
  sublabel?: string;
  href: string;
};

export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  plan: 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';
  emailVerified: boolean;
  parentalConsentStatus: 'NOT_REQUIRED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  createdAt: string;
}

export interface DocumentDTO {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  pageCount: number | null;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  createdAt: string;
  chunks: number;
}

export interface FlashcardDTO {
  id: string;
  userId: string;
  conceptId: string | null;
  sourceChunkId: string | null;
  front: string;
  back: string;
  due: string;
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

export interface NoteDTO {
  id: string;
  title: string;
  content: string;
  workspaceId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

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

export interface ManageFlashcardDTO {
  id: string;
  front: string;
  back: string;
  cardType: 'BASIC' | 'CLOZE' | 'IMAGE_OCCLUSION';
  state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
  due: string | null;
  lastReview: string | null;
  atomName: string | null;
  done: boolean;
}

export interface ManageQuestionDTO {
  id: string;
  prompt: string;
  type: 'MCQ' | 'TRUE_FALSE' | 'SHORT' | 'ESSAY' | 'FILL_BLANK';
  quizTitle: string | null;
  atomName: string | null;
  done: boolean;
  lastCorrect: boolean | null;
  answeredAt: string | null;
}

export interface WorkspaceManageDTO {
  flashcards: ManageFlashcardDTO[];
  questions: ManageQuestionDTO[];
}

export interface MasteryDTO {
  userId: string;
  conceptId: string;
  conceptName: string;
  level: number;
  reviewCount: number;
  lastReviewAt: string | null;
}

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

export interface UsageDTO {
  plan: UserDTO['plan'];
  spentUsd: number;
  quotaUsd: number;
  remainingUsd: number;
  resetAt: string;
  spentPct: number;
}

export interface ApiError {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };
