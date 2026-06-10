-- =============================================================================
-- Migration 0010 — Drop tournament_match (revert Phase 17)
-- =============================================================================
-- User quyết định bỏ TOURNAMENT mode. Drop bảng phụ — exam_mode enum giữ
-- nguyên (không cần ALTER TYPE phức tạp; UI/API không expose value
-- 'TOURNAMENT'/'LIVE'/'ADAPTIVE' nữa).
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0010_drop_tournament.sql
-- =============================================================================

DROP TABLE IF EXISTS "tournament_match";
