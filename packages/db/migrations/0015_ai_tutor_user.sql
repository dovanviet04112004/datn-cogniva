-- =============================================================================
-- Migration 0015 — Seed AI Tutor system user (Phase 20 integration)
-- =============================================================================
-- Tạo 1 user system đại diện cho AI Tutor — khi `@AI` mentioned trong group/DM,
-- AI reply được lưu như message bình thường với author_id = AI Tutor user này.
--
-- ID: 'system-ai-tutor' (cố định để code reference dễ + idempotent insert).
-- Plan: FREE (không gọi billing). Email: '' invalid để chống signup nhầm.
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0015_ai_tutor_user.sql
-- =============================================================================

INSERT INTO "user" (
  "id", "email", "email_verified", "name", "image",
  "plan", "is_public", "preferences",
  "parental_consent_status",
  "created_at", "updated_at"
) VALUES (
  'system-ai-tutor',
  'ai-tutor@cogniva.system',
  true,
  'AI Tutor',
  null,
  'FREE',
  true,
  '{}'::jsonb,
  'NOT_REQUIRED',
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET name = 'AI Tutor';
