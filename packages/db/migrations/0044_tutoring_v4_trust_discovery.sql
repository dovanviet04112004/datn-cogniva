-- Migration 0044 — V4 T5: Trust badges + Reviews v2 + Favorites + Saved Searches.
--
-- Spec: docs/plans/tutoring-v4.md §3 T5.

BEGIN;

-- ─── 1. tutor_review v2 — tag + helpful + photo ───────────────────────
ALTER TABLE tutor_review
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS helpful_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachments jsonb;

CREATE TABLE IF NOT EXISTS tutor_review_helpful (
  review_id text NOT NULL REFERENCES tutor_review(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, user_id)
);

-- ─── 2. tutor_favorite (user ♥ tutor) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_favorite (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tutor_id text NOT NULL REFERENCES tutor_profile(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tutor_id)
);

CREATE INDEX IF NOT EXISTS tutor_favorite_user_idx
  ON tutor_favorite (user_id, created_at DESC);

-- ─── 3. tutor_saved_search ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_saved_search (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL,
  /** Filter snapshot: { subjectSlug, level, budgetMaxVnd, modality, keywords } */
  filters jsonb NOT NULL,
  alert_enabled boolean NOT NULL DEFAULT false,
  last_notified_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tutor_saved_search_user_idx
  ON tutor_saved_search (user_id);

-- ─── 4. Tutor video intro ─────────────────────────────────────────────
ALTER TABLE tutor_profile
  ADD COLUMN IF NOT EXISTS intro_video_url text,
  ADD COLUMN IF NOT EXISTS intro_video_thumb_url text;

COMMIT;
