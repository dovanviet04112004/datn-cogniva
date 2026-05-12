-- =============================================================================
-- Migration 0004 — Audit log + GDPR deletion grace queue
-- =============================================================================
-- Plan v2 §15.1 W9-10 — compliance foundation cho GDPR + SOC2.
--
-- Tables:
--   1. audit_log         — immutable security/compliance events
--   2. deletion_request  — GDPR right-to-erasure grace queue (30-day undo)
--
-- Apply qua drizzle-kit migrate hoặc:
--   psql $DATABASE_URL -f packages/db/migrations/0004_audit_log_gdpr.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────
-- 1. audit_log table
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_id" text,
  "actor_type" text NOT NULL,
  "action" text NOT NULL,
  "result" text NOT NULL,
  "resource_type" text,
  "resource_id" text,
  "ip_address" text,
  "user_agent" text,
  "trace_id" text,
  "metadata" jsonb,
  "timestamp" timestamp DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "audit_log_actor_time_idx"
  ON "audit_log" ("actor_id", "timestamp" DESC);

CREATE INDEX IF NOT EXISTS "audit_log_action_time_idx"
  ON "audit_log" ("action", "timestamp" DESC);

CREATE INDEX IF NOT EXISTS "audit_log_resource_idx"
  ON "audit_log" ("resource_type", "resource_id");

-- BRIN cho time-range scan (append-only correlate physical order)
CREATE INDEX IF NOT EXISTS "audit_log_time_brin_idx"
  ON "audit_log" USING brin ("timestamp")
  WITH (pages_per_range = 32);

-- ─────────────────────────────────────────────────────────
-- 2. Immutable enforcement — trigger block UPDATE/DELETE
-- ─────────────────────────────────────────────────────────
-- Audit log phải append-only cho compliance. Trigger reject mọi modification
-- ngoại trừ INSERT. Bypass chỉ qua DB superuser (ops emergency).
CREATE OR REPLACE FUNCTION audit_log_block_modification()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only — UPDATE/DELETE blocked for compliance';
END;
$$ LANGUAGE plpgsql;

-- Drop if exists để re-run migration idempotent
DROP TRIGGER IF EXISTS trg_audit_log_no_update ON "audit_log";
DROP TRIGGER IF EXISTS trg_audit_log_no_delete ON "audit_log";

CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_modification();

CREATE TRIGGER trg_audit_log_no_delete
  BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_modification();

-- ─────────────────────────────────────────────────────────
-- 3. deletion_request table
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "deletion_request" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "reason" text,
  "scheduled_for" timestamp NOT NULL,
  "completed_at" timestamp,
  "error_message" text,
  "requested_at" timestamp DEFAULT now() NOT NULL
);

-- Index: pickup scheduled jobs trong Inngest cron
CREATE INDEX IF NOT EXISTS "deletion_request_status_scheduled_idx"
  ON "deletion_request" ("status", "scheduled_for")
  WHERE "status" IN ('PENDING', 'PROCESSING');

-- Index: user-side lookup (account dashboard)
CREATE INDEX IF NOT EXISTS "deletion_request_user_idx"
  ON "deletion_request" ("user_id", "requested_at" DESC);
