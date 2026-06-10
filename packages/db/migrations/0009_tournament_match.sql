-- =============================================================================
-- Migration 0009 — Tournament bracket (Phase 17)
-- =============================================================================
-- 1 bảng: tournament_match. Lưu phẳng các trận 1-vs-1, identify qua
-- (exam_id, round, match_index). Bracket pairing: matchIndex i round R+1
-- là winner của match (2i, 2i+1) ở round R.
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0009_tournament_match.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS "tournament_match" (
  "id"               text PRIMARY KEY,
  "exam_id"          text NOT NULL REFERENCES "exam"("id") ON DELETE CASCADE,
  "round"            integer NOT NULL,
  "match_index"      integer NOT NULL,
  "player1_id"       text REFERENCES "user"("id") ON DELETE SET NULL,
  "player2_id"       text REFERENCES "user"("id") ON DELETE SET NULL,
  "winner_id"        text REFERENCES "user"("id") ON DELETE SET NULL,
  "player1_score"    real,
  "player2_score"    real,
  "status"           text NOT NULL DEFAULT 'PENDING',
  "question_id"      text REFERENCES "exam_question"("id") ON DELETE SET NULL,
  "started_at"       timestamp,
  "ended_at"         timestamp,
  "created_at"       timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "tournament_match_exam_round_idx"
  ON "tournament_match" ("exam_id", "round", "match_index");
CREATE INDEX IF NOT EXISTS "tournament_match_player1_idx"
  ON "tournament_match" ("player1_id");
CREATE INDEX IF NOT EXISTS "tournament_match_player2_idx"
  ON "tournament_match" ("player2_id");
