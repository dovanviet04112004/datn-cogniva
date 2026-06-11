export type UserPreferences = {
  language?: string;
  learningStyle?: 'visual' | 'auditory' | 'reading' | 'kinesthetic';
  dailyGoalMinutes?: number;
  pomodoro?: { workMins: number; breakMins: number };
};

export type DocumentMetadata = {
  pageCount?: number;
  language?: string;
  source?: 'upload' | 'url' | 'youtube';
  url?: string;
  duration?: number;
};

export type ChunkMetadata = {
  page?: number;
  section?: string;
  chunkIndex: number;
  topics?: string[];
  difficulty?: number;
  type?: 'narrative' | 'definition' | 'example' | 'exercise' | 'figure';
};

export type Citation = {
  chunkId: string;
  score: number;
  snippet: string;
};

export type MessageMetadata = {
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  retrievalStrategy?: string;
  chunkCount?: number;
  cacheHit?: boolean;
};

export type QuizConfig = {
  difficulty?: 'easy' | 'medium' | 'hard' | 'adaptive';
  types?: Array<'MCQ' | 'TRUE_FALSE' | 'SHORT' | 'ESSAY' | 'FILL_BLANK'>;
  conceptIds?: string[];
  questionCount?: number;
};
