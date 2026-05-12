-- =============================================================================
-- Migration 0002 — Hot-path indexes + slow-query mitigation
-- =============================================================================
-- Plan v2 §15.1 W3-4 (DB scaling foundation) — risk T4 + T5 mitigation.
--
-- MỌI CREATE INDEX DÙNG `CONCURRENTLY` để KHÔNG LOCK TABLE.
-- CONCURRENTLY caveat:
--   - KHÔNG chạy được trong transaction → cần `--no-transaction` flag với
--     drizzle-kit, hoặc apply manual qua psql.
--   - Lâu hơn 2-5x so với CREATE INDEX thường.
--   - Có thể fail mid-way → re-run idempotent với IF NOT EXISTS.
--
-- Cách apply:
--   psql $DATABASE_URL -f packages/db/migrations/0002_hot_path_indexes.sql
--
-- Hoặc set drizzle-kit:
--   pnpm drizzle-kit push --custom packages/db/migrations/0002_hot_path_indexes.sql
--
-- Verify sau khi apply:
--   SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid))
--   FROM pg_indexes JOIN pg_class ON pg_class.relname = indexname
--   WHERE schemaname = 'public' ORDER BY pg_relation_size(indexrelid) DESC;
-- =============================================================================

-- ─────────────────────────────────────────────────────────
-- 1. AUTH HOT PATH — Better Auth session lookup mỗi request
-- ─────────────────────────────────────────────────────────
-- Better Auth tra session theo token mỗi request. Token unique nhưng
-- (user_id, expires_at) compound giúp cleanup expired session nhanh + RBAC
-- list active session per user.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "session_user_expires_idx"
  ON "session" ("user_id", "expires_at" DESC);

-- Account OAuth lookup (provider + provider_account_id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "account_provider_user_idx"
  ON "account" ("provider_id", "user_id");

-- ─────────────────────────────────────────────────────────
-- 2. FLASHCARD REVIEW QUEUE — top hot path (mỗi user load deck)
-- ─────────────────────────────────────────────────────────
-- Existing flashcard_user_due_idx (user_id, due) đã có. Thêm partial cho
-- state lọc NEW + LEARNING + REVIEW (bỏ RELEARNING) — query "due today" thường.
-- Partial index giảm size 60-80% so với full vì hầu hết card state khác.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "flashcard_due_active_partial_idx"
  ON "flashcard" ("user_id", "due")
  WHERE "state" IN ('NEW', 'LEARNING', 'REVIEW');

-- Lookup card theo concept (mastery dashboard "cards về concept X")
CREATE INDEX CONCURRENTLY IF NOT EXISTS "flashcard_concept_idx"
  ON "flashcard" ("concept_id")
  WHERE "concept_id" IS NOT NULL;

-- ─────────────────────────────────────────────────────────
-- 3. REVIEW HISTORY — FSRS training data + analytics
-- ─────────────────────────────────────────────────────────
-- Review table append-only, query theo (flashcard_id, time) hoặc
-- (user_id, time) cho dashboard "reviews today". BRIN index siêu rẻ cho
-- append-only timestamp (~ 1/1000 size BTREE) khi data correlate physical order.
--
-- BRIN tốt cho range scan "last 7 days", kém cho point lookup.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "review_flashcard_time_idx"
  ON "review" ("flashcard_id", "reviewed_at" DESC);

-- BRIN cho user-level range scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS "review_user_time_brin_idx"
  ON "review" USING brin ("user_id", "reviewed_at")
  WITH (pages_per_range = 32);

-- ─────────────────────────────────────────────────────────
-- 4. MASTERY DASHBOARD — list per user
-- ─────────────────────────────────────────────────────────
-- Existing mastery_user_concept_uniq đã cover query lookup point. Thêm
-- partial index cho "user mastered concepts" (filter score > threshold)
-- và sort by last_reviewed cho recent activity view.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "mastery_user_mastered_idx"
  ON "mastery" ("user_id", "score" DESC)
  WHERE "score" >= 0.8;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "mastery_user_reviewed_idx"
  ON "mastery" ("user_id", "last_reviewed_at" DESC NULLS LAST);

-- ─────────────────────────────────────────────────────────
-- 5. DOCUMENT LIST — workspace/user filter + status filter
-- ─────────────────────────────────────────────────────────
-- Existing document_user_workspace_idx OK cho list. Thêm partial cho
-- status='READY' (filter mặc định trong RAG retrieval).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "document_ready_partial_idx"
  ON "document" ("user_id", "created_at" DESC)
  WHERE "status" = 'READY';

-- Lookup by R2 key (storage lifecycle, dedup check)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "document_storage_key_idx"
  ON "document" ("storage_key")
  WHERE "storage_key" IS NOT NULL;

-- ─────────────────────────────────────────────────────────
-- 6. CONVERSATION + MESSAGE — chat history paginate
-- ─────────────────────────────────────────────────────────
-- Load conversation list per user sort recent
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_user_updated_idx"
  ON "conversation" ("user_id", "updated_at" DESC);

-- Message paginate within conversation
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_conv_created_idx"
  ON "message" ("conversation_id", "created_at" ASC);

-- ─────────────────────────────────────────────────────────
-- 7. ROOM MEMBER — find user's active rooms
-- ─────────────────────────────────────────────────────────
-- Existing room_member_user_idx + room_member_status_idx. Add composite
-- (user_id, status) cho query "rooms tôi là member ACTIVE" — most common.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "room_member_user_active_idx"
  ON "room_member" ("user_id", "status", "joined_at" DESC)
  WHERE "status" = 'ACTIVE';

-- ─────────────────────────────────────────────────────────
-- 8. ROOM MESSAGE — recent N theo room (chat scroll)
-- ─────────────────────────────────────────────────────────
-- Existing room_message_room_time_idx cover. Thêm BRIN cho audit/analytics
-- "all room messages last 7 days" — append-only correlate physical.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "room_message_time_brin_idx"
  ON "room_message" USING brin ("created_at")
  WITH (pages_per_range = 32);

-- ─────────────────────────────────────────────────────────
-- 9. ROOM EVENT (audit) — BRIN cho time-range scan
-- ─────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "room_event_time_brin_idx"
  ON "room_event" USING brin ("timestamp")
  WITH (pages_per_range = 32);

-- ─────────────────────────────────────────────────────────
-- 10. CONCEPT SEARCH — trigram cho fuzzy search VN
-- ─────────────────────────────────────────────────────────
-- pg_trgm extension dùng cho ILIKE/typo-tolerant search.
-- Cần pg_trgm extension đã enabled. Neon mặc định available, chỉ cần CREATE EXTENSION.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "concept_name_trgm_idx"
  ON "concept" USING gin ("name" gin_trgm_ops);

-- ─────────────────────────────────────────────────────────
-- 11. CHUNK FULL-TEXT (Vietnamese) — multilingual support
-- ─────────────────────────────────────────────────────────
-- Existing chunk_content_tsv_idx dùng 'english' config — chunk tiếng Việt
-- không được stem đúng. Thêm 'simple' config (token-based, không stem) hoạt
-- động đa ngôn ngữ — recall thấp hơn nhưng không miss VN.
--
-- Phase 3+ sẽ migrate sang custom VN tokenizer (vntk hoặc underthesea). Hiện
-- 'simple' đủ.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chunk_content_simple_tsv_idx"
  ON "chunk" USING gin (to_tsvector('simple', "content"));

-- ─────────────────────────────────────────────────────────
-- 12. STUDY SESSION — daily stats query
-- ─────────────────────────────────────────────────────────
-- Filter by date for streak calculation + dashboard
CREATE INDEX CONCURRENTLY IF NOT EXISTS "study_session_user_date_idx"
  ON "study_session" ("user_id", "started_at" DESC);

-- ─────────────────────────────────────────────────────────
-- 13. ROOM JOIN by code (public action — high frequency)
-- ─────────────────────────────────────────────────────────
-- Existing room_join_code_idx OK NHƯNG là full index. Add partial cho
-- visibility != PRIVATE để join-by-code chỉ scan public rooms.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "room_public_code_idx"
  ON "room" ("join_code")
  WHERE "visibility" != 'PRIVATE' AND "join_code" IS NOT NULL;

-- ─────────────────────────────────────────────────────────
-- 14. RECORDING list per room
-- ─────────────────────────────────────────────────────────
-- Existing recording_room_idx cover. Thêm sort by started_at DESC cho list UI
CREATE INDEX CONCURRENTLY IF NOT EXISTS "recording_room_time_idx"
  ON "recording" ("room_id", "started_at" DESC);

-- ─────────────────────────────────────────────────────────
-- ANALYSIS: gợi ý dùng EXPLAIN trên hot query để verify index hit
-- ─────────────────────────────────────────────────────────
-- Sau khi apply, chạy:
--
-- EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM flashcard
-- WHERE user_id = 'x' AND state IN ('NEW','LEARNING','REVIEW') AND due <= NOW()
-- ORDER BY due LIMIT 50;
--
-- Phải thấy "Index Scan using flashcard_due_active_partial_idx".
-- Nếu thấy "Seq Scan" — index không hit, cần check WHERE clause match.

-- ─────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (nếu cần)
-- ─────────────────────────────────────────────────────────
-- DROP INDEX CONCURRENTLY là online → an toàn rollback từng index một.
--
-- DROP INDEX CONCURRENTLY IF EXISTS "session_user_expires_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "account_provider_user_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "flashcard_due_active_partial_idx";
-- ... (tất cả index trên)
