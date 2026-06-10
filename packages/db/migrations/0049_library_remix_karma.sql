-- ============================================================================
-- Migration 0049 — Library Remix + Karma (Phase 3 Bonus #12, 2026-05-27)
--
-- Remix: user gộp 2-5 doc nguồn → tạo "Tổng hợp của mình" → republish với
-- attribution. Wiki-style knowledge compounding.
--
-- Karma: source uploader nhận points khi doc được remix / import / endorse.
-- ============================================================================

-- ─── library_doc: parent remix tracking ──────────────────────────────
ALTER TABLE library_doc
  ADD COLUMN IF NOT EXISTS parent_remix_doc_ids text[] DEFAULT '{}'::text[];

ALTER TABLE library_doc
  ADD COLUMN IF NOT EXISTS remix_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS library_doc_parent_remix_gin
  ON library_doc USING gin(parent_remix_doc_ids);

-- ─── library_creator_karma: karma points per user ────────────────────
CREATE TABLE IF NOT EXISTS library_creator_karma (
  user_id         text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  points          integer NOT NULL DEFAULT 0,
  /** Top 10 contributor cập nhật rank weekly (Phase 4 cron). */
  rank            integer,
  last_event_at   timestamp,
  updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_creator_karma_points_idx
  ON library_creator_karma (points DESC);

-- ─── library_karma_event: audit trail mỗi karma transaction ──────────
CREATE TABLE IF NOT EXISTS library_karma_event (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  /** 'doc_imported' (+1) | 'doc_remixed' (+5) | 'endorsed' (+10) | 'high_quality' (+20). */
  event_type      text NOT NULL,
  points          integer NOT NULL,
  /** Doc liên quan để link audit. */
  doc_id          text REFERENCES library_doc(id) ON DELETE SET NULL,
  context         jsonb,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_karma_event_user_idx
  ON library_karma_event (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS library_karma_event_type_idx
  ON library_karma_event (event_type, created_at DESC);
