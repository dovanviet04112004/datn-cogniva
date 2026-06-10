-- Migration 0040 — V4 T1: AI Concierge + Hybrid Search.
--
-- Spec: docs/plans/tutoring-v4.md §3 T1 + §7.5.
--
-- 3 thay đổi:
--   1. tutoring_concierge_thread + message — lưu lịch sử chat với AI Concierge
--      (tách khỏi AI Tutor để analytics riêng + có metadata filter cache)
--   2. tsvector search_vec trên tutor_profile (bio + headline) cho FTS,
--      kết hợp pgvector cosine via Reciprocal Rank Fusion
--   3. bio_embedding_updated_at — Inngest cron daily refresh khi stale

BEGIN;

-- ─── 1. Concierge thread + message ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutoring_concierge_thread (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  /** Title auto-generate từ message đầu tiên (vd "Toán 11 dưới 200k"). */
  title text,
  /** Last message timestamp — sort thread list DESC. */
  last_message_at timestamp NOT NULL DEFAULT now(),
  /**
   * Cache filter user pick trong cuộc — re-open cuộc cũ vẫn còn context.
   * Format: { subjectSlug, level, budgetMaxVnd, modality, city, ... }
   */
  extracted_filters jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tutoring_concierge_thread_user_time_idx
  ON tutoring_concierge_thread (user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS tutoring_concierge_message (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES tutoring_concierge_thread(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text NOT NULL,
  /**
   * Tool call result jsonb cho assistant message khi action='search'.
   * Format: { action: 'search'|'clarify', tutorIds: [], filters: {}, total: 0 }
   */
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tutoring_concierge_message_thread_time_idx
  ON tutoring_concierge_message (thread_id, created_at);

-- ─── 2. tsvector search_vec trên tutor_profile ─────────────────────────
-- Generated column auto-update khi bio/headline thay đổi.
ALTER TABLE tutor_profile
  ADD COLUMN IF NOT EXISTS search_vec tsvector
    GENERATED ALWAYS AS (
      to_tsvector('simple', coalesce(bio, '') || ' ' || coalesce(headline, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS tutor_profile_search_idx
  ON tutor_profile USING GIN (search_vec);

-- ─── 3. Embedding freshness tracker ────────────────────────────────────
ALTER TABLE tutor_profile
  ADD COLUMN IF NOT EXISTS bio_embedding_updated_at timestamp;

-- Backfill: tutor đã có embedding sẵn → set updated_at = now() để cron không refresh ngay
UPDATE tutor_profile
   SET bio_embedding_updated_at = now()
 WHERE bio_embedding IS NOT NULL
   AND bio_embedding_updated_at IS NULL;

COMMIT;
