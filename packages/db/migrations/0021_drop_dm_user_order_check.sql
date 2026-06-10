-- =============================================================================
-- Migration 0021 — Drop dm_thread_user_order_chk constraint
-- =============================================================================
-- CHECK constraint `user1_id < user2_id` dùng collation default của PG
-- (thường `en_US.UTF-8`) — so sánh case-insensitive locale-aware. App-level
-- sort dùng JS string `<` — so sánh ASCII case-sensitive. → Bất nhất:
--
-- Vd:
--   - 'Q6NPejUm...' vs 'mibvfcfq...'
--   - JS: 'Q' < 'm' (81 < 109) → app insert [Q, m]
--   - PG locale: 'Q' ≈ 'q' > 'm' alphabet → CHECK fail → 500
--
-- Fix: drop CHECK. App-level `orderUserIds()` đảm bảo consistency. UNIQUE
-- constraint trên (user1_id, user2_id) đủ để chặn duplicate pair (cùng app
-- sort → cùng key → dedupe).
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0021_drop_dm_user_order_check.sql
-- =============================================================================

ALTER TABLE "dm_thread"
  DROP CONSTRAINT IF EXISTS "dm_thread_user_order_chk";
