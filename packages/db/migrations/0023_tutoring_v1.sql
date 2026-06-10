-- ─────────────────────────────────────────────────────────────────────────
-- Migration 0023 — Tutoring Marketplace V1 (Phase 21)
--
-- 5 bảng mới: tutor_profile, tutor_subject, tutor_availability,
-- tutor_request, tutor_application. Booking + review thêm ở V2 (0024).
--
-- Reference: docs/plans/tutoring.md §4
-- Rollback: DROP TABLE theo thứ tự ngược (application → request →
--           availability → subject → profile).
-- ─────────────────────────────────────────────────────────────────────────

-- ── tutor_profile — 1 user max 1 profile ────────────────────────────────
CREATE TABLE IF NOT EXISTS "tutor_profile" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL UNIQUE,
  "headline" text NOT NULL,
  "bio" text NOT NULL,
  "hourly_rate_vnd" integer NOT NULL,
  "modality" text NOT NULL DEFAULT 'ONLINE',
  "avatar_url" text,
  "banner_url" text,
  "sessions_completed" integer NOT NULL DEFAULT 0,
  "rating_avg" numeric(3, 2),
  "rating_count" integer NOT NULL DEFAULT 0,
  "verification_status" text NOT NULL DEFAULT 'NONE',
  "bio_embedding" vector(1024),
  "status" text NOT NULL DEFAULT 'DRAFT',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "tutor_profile_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "tutor_profile_status_idx" ON "tutor_profile" ("status");
CREATE INDEX IF NOT EXISTS "tutor_profile_modality_idx" ON "tutor_profile" ("modality", "status");

-- ── tutor_subject — N môn / 1 tutor ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tutor_subject" (
  "id" text PRIMARY KEY NOT NULL,
  "tutor_id" text NOT NULL,
  "subject_slug" text NOT NULL,
  "level" text NOT NULL,
  "verified_at" timestamp,
  "verify_score" integer,
  CONSTRAINT "tutor_subject_tutor_id_fkey"
    FOREIGN KEY ("tutor_id") REFERENCES "tutor_profile"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "tutor_subject_uniq"
  ON "tutor_subject" ("tutor_id", "subject_slug", "level");
CREATE INDEX IF NOT EXISTS "tutor_subject_subject_idx"
  ON "tutor_subject" ("subject_slug", "level");

-- ── tutor_availability — recurring weekly slot ──────────────────────────
CREATE TABLE IF NOT EXISTS "tutor_availability" (
  "id" text PRIMARY KEY NOT NULL,
  "tutor_id" text NOT NULL,
  "day_of_week" integer NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "timezone" text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  CONSTRAINT "tutor_availability_tutor_id_fkey"
    FOREIGN KEY ("tutor_id") REFERENCES "tutor_profile"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "tutor_availability_tutor_idx"
  ON "tutor_availability" ("tutor_id");

-- ── tutor_request — student post yêu cầu ────────────────────────────────
CREATE TABLE IF NOT EXISTS "tutor_request" (
  "id" text PRIMARY KEY NOT NULL,
  "student_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "subject_slug" text NOT NULL,
  "level" text NOT NULL,
  "budget_vnd" integer,
  "modality" text NOT NULL DEFAULT 'ONLINE',
  "urgency" text NOT NULL DEFAULT 'FLEXIBLE',
  "status" text NOT NULL DEFAULT 'OPEN',
  "embedding" vector(1024),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp,
  CONSTRAINT "tutor_request_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "tutor_request_subject_idx"
  ON "tutor_request" ("subject_slug", "level", "status");
CREATE INDEX IF NOT EXISTS "tutor_request_student_idx"
  ON "tutor_request" ("student_id", "created_at");

-- ── tutor_application — tutor apply request ─────────────────────────────
CREATE TABLE IF NOT EXISTS "tutor_application" (
  "id" text PRIMARY KEY NOT NULL,
  "request_id" text NOT NULL,
  "tutor_id" text NOT NULL,
  "message" text NOT NULL,
  "proposed_rate_vnd" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "tutor_application_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "tutor_request"("id") ON DELETE CASCADE,
  CONSTRAINT "tutor_application_tutor_id_fkey"
    FOREIGN KEY ("tutor_id") REFERENCES "tutor_profile"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "tutor_application_uniq"
  ON "tutor_application" ("request_id", "tutor_id");
CREATE INDEX IF NOT EXISTS "tutor_application_tutor_idx"
  ON "tutor_application" ("tutor_id", "created_at");

-- ── HNSW indexes cho vector cosine matching (V2 dùng) ───────────────────
-- Tạo sẵn ở V1 để khi V2 implement matching không phải migrate lại.
CREATE INDEX IF NOT EXISTS "tutor_profile_bio_embedding_idx"
  ON "tutor_profile" USING hnsw ("bio_embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "tutor_request_embedding_idx"
  ON "tutor_request" USING hnsw ("embedding" vector_cosine_ops);
