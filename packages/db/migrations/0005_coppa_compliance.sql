-- =============================================================================
-- Migration 0005 — COPPA compliance (age verification + parental consent)
-- =============================================================================
-- Plan v2 §3.7.2 + §15.1 W9-10.
--
-- Adds:
--   1. parental_consent_status enum
--   2. user.date_of_birth (nullable cho legacy compat)
--   3. user.parental_consent_status (default NOT_REQUIRED)
--   4. user.parent_email
--   5. user.parental_consent_at
--
-- Legacy users (created trước migration) sẽ default NOT_REQUIRED — assume adult.
-- Stage 2 có thể prompt re-confirm tuổi cho legacy nếu cần (rare).
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0005_coppa_compliance.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────
-- 1. Enum
-- ─────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "parental_consent_status" AS ENUM ('NOT_REQUIRED', 'PENDING', 'VERIFIED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────────────────
-- 2. Add columns to user (idempotent với IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "date_of_birth" timestamp;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "parental_consent_status" "parental_consent_status" NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "parent_email" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "parental_consent_at" timestamp;

-- ─────────────────────────────────────────────────────────
-- 3. Index: tìm user PENDING cho admin dashboard + cron cleanup
-- ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "user_consent_pending_idx"
  ON "user" ("parental_consent_status", "created_at")
  WHERE "parental_consent_status" = 'PENDING';

-- ─────────────────────────────────────────────────────────
-- 4. Constraint: nếu PENDING/VERIFIED → bắt buộc có parent_email
-- ─────────────────────────────────────────────────────────
-- (KHÔNG enforce qua DB constraint vì transitional state — app layer enforce)
