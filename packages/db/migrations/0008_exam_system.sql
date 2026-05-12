-- =============================================================================
-- Migration 0008 — Exam System Core (Phase 16)
-- =============================================================================
-- 5 bảng: exam, exam_question, exam_attempt, exam_response, exam_violation.
-- Enum: exam_mode, exam_status, attempt_status.
--
-- Schema có sẵn cột cho Phase 17 (Live), Phase 18 (Adaptive/IRT), Phase 19
-- (Anti-cheat) để migration sau không phải breaking change.
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0008_exam_system.sql
-- =============================================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE "exam_mode" AS ENUM ('PRACTICE', 'TIMED', 'LIVE', 'ASYNC', 'ADAPTIVE', 'TOURNAMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "exam_status" AS ENUM ('DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'ENDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "attempt_status" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'TIMED_OUT', 'AUTO_SUBMITTED', 'DISQUALIFIED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─── exam ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam" (
  "id"                       text PRIMARY KEY,
  "owner_id"                 text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "title"                    text NOT NULL,
  "description"              text,
  "mode"                     "exam_mode" NOT NULL DEFAULT 'PRACTICE',
  "status"                   "exam_status" NOT NULL DEFAULT 'DRAFT',
  "duration_seconds"         integer,
  "starts_at"                timestamp,
  "ends_at"                  timestamp,
  "passing_score"            real,
  "max_score"                real NOT NULL DEFAULT 0,
  "show_results"             text NOT NULL DEFAULT 'IMMEDIATE',
  "shuffle_questions"        boolean NOT NULL DEFAULT true,
  "shuffle_options"          boolean NOT NULL DEFAULT true,
  "allow_review"             boolean NOT NULL DEFAULT true,
  "max_attempts"             integer NOT NULL DEFAULT 1,
  "live_code"                text UNIQUE,
  "current_question_index"   integer,
  "min_questions"            integer DEFAULT 10,
  "max_questions"            integer DEFAULT 30,
  "target_se"                real DEFAULT 0.3,
  "anti_cheat"               jsonb DEFAULT '{}'::jsonb,
  "classroom_id"             text,
  "concept_ids"              jsonb,
  "created_at"               timestamp NOT NULL DEFAULT now(),
  "published_at"             timestamp
);

CREATE INDEX IF NOT EXISTS "exam_owner_status_idx" ON "exam" ("owner_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "exam_live_code_idx" ON "exam" ("live_code") WHERE "live_code" IS NOT NULL;


-- ─── exam_question ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_question" (
  "id"                  text PRIMARY KEY,
  "exam_id"             text NOT NULL REFERENCES "exam"("id") ON DELETE CASCADE,
  "type"                text NOT NULL,
  "prompt"              text NOT NULL,
  "prompt_html"         text,
  "attachments"         jsonb,
  "options"             jsonb,
  "correct_answer"      jsonb,
  "acceptable_answers"  jsonb,
  "rubric"              jsonb,
  "test_cases"          jsonb,
  "points"              real NOT NULL DEFAULT 1,
  "partial_credit"      boolean NOT NULL DEFAULT false,
  "difficulty"          real NOT NULL DEFAULT 0,
  "discrimination"      real NOT NULL DEFAULT 1,
  "guessing"            real NOT NULL DEFAULT 0,
  "concept_id"          text REFERENCES "concept"("id") ON DELETE SET NULL,
  "explanation"         text,
  "hint"                text,
  "time_limit_seconds"  integer,
  "order_index"         integer NOT NULL DEFAULT 0,
  "created_at"          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "exam_question_exam_order_idx" ON "exam_question" ("exam_id", "order_index");


-- ─── exam_attempt ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_attempt" (
  "id"                      text PRIMARY KEY,
  "exam_id"                 text NOT NULL REFERENCES "exam"("id") ON DELETE CASCADE,
  "user_id"                 text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status"                  "attempt_status" NOT NULL DEFAULT 'IN_PROGRESS',
  "started_at"              timestamp NOT NULL DEFAULT now(),
  "submitted_at"            timestamp,
  "score"                   real,
  "max_score"               real,
  "percentage"              real,
  "passed"                  boolean,
  "estimated_theta"         real,
  "theta_se"                real,
  "time_spent_seconds"      integer,
  "questions_answered"      integer NOT NULL DEFAULT 0,
  "violations"              jsonb,
  "cheat_risk_score"        real,
  "flagged"                 boolean NOT NULL DEFAULT false,
  "flag_reason"             text,
  "webcam_recording_url"    text,
  "proctor_notes"           text,
  "ip_address"              text,
  "user_agent"              text,
  "browser_fingerprint"     text
);

CREATE INDEX IF NOT EXISTS "exam_attempt_exam_user_idx" ON "exam_attempt" ("exam_id", "user_id");
CREATE INDEX IF NOT EXISTS "exam_attempt_user_status_idx" ON "exam_attempt" ("user_id", "status");


-- ─── exam_response ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_response" (
  "id"               text PRIMARY KEY,
  "attempt_id"       text NOT NULL REFERENCES "exam_attempt"("id") ON DELETE CASCADE,
  "question_id"      text NOT NULL REFERENCES "exam_question"("id") ON DELETE CASCADE,
  "answer"           jsonb,
  "is_correct"       boolean,
  "points_earned"    real NOT NULL DEFAULT 0,
  "started_at"       timestamp,
  "submitted_at"     timestamp,
  "response_time_ms" integer,
  "rank_at_submit"   integer,
  "ai_grading"       jsonb,
  "manual_grading"   jsonb,
  "needs_review"     boolean NOT NULL DEFAULT false,
  "reviewed_by"      text REFERENCES "user"("id") ON DELETE SET NULL,
  "reviewed_at"      timestamp,
  "created_at"       timestamp NOT NULL DEFAULT now()
);

-- Upsert key: 1 response/question/attempt
CREATE UNIQUE INDEX IF NOT EXISTS "exam_response_attempt_question_idx"
  ON "exam_response" ("attempt_id", "question_id");


-- ─── exam_violation ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_violation" (
  "id"          text PRIMARY KEY,
  "attempt_id"  text NOT NULL REFERENCES "exam_attempt"("id") ON DELETE CASCADE,
  "type"        text NOT NULL,
  "severity"    text NOT NULL,
  "metadata"    jsonb,
  "timestamp"   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "exam_violation_attempt_idx" ON "exam_violation" ("attempt_id");
