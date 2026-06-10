-- =============================================================================
-- Migration 0056 — Chat hot-path indexes (conversation + message)
-- =============================================================================
-- Tier 2 DB (plan: docs/plans/redis-cache.md §9). Lấp lỗ index TRƯỚC khi làm cache.
--
-- BỐI CẢNH (vì sao 0002 KHÔNG đủ):
--   - Migration 0002 đã KHAI BÁO 2 index này nhưng:
--       • `conversation_user_updated_idx` trỏ cột `updated_at` — conversation
--         KHÔNG có cột đó (chỉ có created_at) ⇒ statement đó LỖI, không apply được.
--       • DB dev dựng bằng `db:push` từ schema.ts (vốn chưa khai báo index) nên
--         message/conversation thực tế CHỈ có primary key (đã verify pg_indexes).
--   - Hệ quả: cả 2 bảng đang seq-scan. Migration này sửa GỐC, dùng đúng cột tồn tại.
--
-- MỌI CREATE INDEX DÙNG `CONCURRENTLY IF NOT EXISTS`:
--   - CONCURRENTLY → không lock write trên bảng `message` (bảng lớn nhất ở prod).
--   - IF NOT EXISTS → idempotent, an toàn re-run + an toàn nếu 0002 từng tạo phần message.
--   - CONCURRENTLY KHÔNG chạy trong transaction → apply ở chế độ autocommit:
--       docker exec -i cogniva-postgres psql -U cogniva -d cogniva < \
--         packages/db/migrations/0056_chat_hot_path_indexes.sql
--     (KHÔNG dùng --single-transaction.)
-- =============================================================================

-- ─────────────────────────────────────────────────────────
-- 1. MESSAGE — load 1 cuộc chat + analytics nested-loop
-- ─────────────────────────────────────────────────────────
-- Hai query nóng:
--   (a) Mở chat:  WHERE conversation_id = X ORDER BY created_at
--   (b) Analytics: message ⋈ conversation, lọc created_at trong từng conversation
-- (conversation_id, created_at) phục vụ cả hai. Postgres KHÔNG tự index FK.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_conv_created_idx"
  ON "message" ("conversation_id", "created_at");

-- ─────────────────────────────────────────────────────────
-- 2. CONVERSATION — list hội thoại của user + driver của analytics join
-- ─────────────────────────────────────────────────────────
-- Query nóng:
--   (a) Sidebar chat: WHERE user_id = X ORDER BY created_at DESC
--   (b) Analytics: WHERE c.user_id = X (chọn tập conversation rồi nested-loop message)
-- Dùng created_at (conversation KHÔNG có updated_at) làm mốc recency.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_user_created_idx"
  ON "conversation" ("user_id", "created_at");

-- ─────────────────────────────────────────────────────────
-- VERIFY sau khi apply
-- ─────────────────────────────────────────────────────────
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT count(*) FROM message m
-- INNER JOIN conversation c ON c.id = m.conversation_id
-- WHERE c.user_id = '<id>' AND m.role = 'ASSISTANT'
--   AND m.created_at > now() - interval '30 days';
-- → phải thấy Index Scan dùng conversation_user_created_idx + message_conv_created_idx,
--   KHÔNG còn "Seq Scan on message".
--
-- ROLLBACK (online, an toàn):
-- DROP INDEX CONCURRENTLY IF EXISTS "message_conv_created_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "conversation_user_created_idx";
