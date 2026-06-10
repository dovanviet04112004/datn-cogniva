-- Migration 0038 — V2 G5 forum solution-mark.
--
-- Spec: docs/plans/study-group-v2.md §G5.
--
-- Discord forum cho phép đánh dấu 1 reply là "Solution" — UI hiện badge xanh
-- ở reply + badge "Đã giải đáp" ở post card list. Chỉ 1 reply / thread được
-- đánh dấu (logic UPDATE bỏ flag cũ trước khi set mới — handled in API).
--
-- Quyền: post author HOẶC mod+ (channel.manage).
--
-- 2 thay đổi:
--   1. ADD study_group_message.is_solution boolean default false
--   2. Partial index để query "thread X có solution nào" nhanh

BEGIN;

ALTER TABLE study_group_message
  ADD COLUMN IF NOT EXISTS is_solution boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS study_group_message_solution_idx
  ON study_group_message (thread_root_id)
  WHERE is_solution = true;

COMMIT;
