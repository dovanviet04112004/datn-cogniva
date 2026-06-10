-- ============================================================================
-- Migration 0045 — Tutoring V5: FTS search_vec cho tutor_request.
-- Spec: docs/plans/tutoring-v5-concierge-prod.md §Phase 2.
-- ============================================================================

-- FTS column generated stored: title weight A, description weight B.
ALTER TABLE tutor_request
  ADD COLUMN IF NOT EXISTS search_vec tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS tutor_request_search_vec_gin
  ON tutor_request USING gin(search_vec);

-- Embedding refresh timestamp tracking (mirror tutor_profile pattern).
ALTER TABLE tutor_request
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamp;
