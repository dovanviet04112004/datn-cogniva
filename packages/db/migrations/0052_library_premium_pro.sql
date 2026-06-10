-- ============================================================================
-- Migration 0052 — Library Premium Purchase + PRO Subscription
-- (Phase 4 Step 5, 2026-05-27)
--
-- Thêm:
--   1. Table library_doc_purchase   — track buyer × doc purchase (unique)
--   2. user.pro_until_at            — timestamp hết hạn PRO; cron daily check
--   3. Index library_doc_purchase   — lookup nhanh "buyer đã sở hữu doc chưa"
-- ============================================================================

-- 1. Premium purchase ledger
CREATE TABLE IF NOT EXISTS library_doc_purchase (
  id text PRIMARY KEY,
  doc_id text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  buyer_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  /* Snapshot tại lúc mua — admin update giá sau không ảnh hưởng purchase cũ. */
  price_vnd integer NOT NULL,
  creator_share_vnd integer NOT NULL,
  platform_share_vnd integer NOT NULL,
  /* Loose FK tới user_wallet_txn.id của giao dịch CHARGE buyer (BOOKING_PAY-like). */
  wallet_txn_id text,
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS library_doc_purchase_unique
  ON library_doc_purchase(doc_id, buyer_id);

CREATE INDEX IF NOT EXISTS library_doc_purchase_buyer_idx
  ON library_doc_purchase(buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS library_doc_purchase_doc_idx
  ON library_doc_purchase(doc_id, created_at DESC);

COMMENT ON TABLE library_doc_purchase IS
  'Premium doc purchase ledger — buyer trả VND để unlock isPremium=true doc. Unique (doc_id, buyer_id) chống double-charge.';

-- 2. PRO subscription expiry
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS pro_until_at timestamp;

COMMENT ON COLUMN "user".pro_until_at IS
  'PRO subscription hết hạn lúc nào. NULL = chưa từng PRO. Cron daily check < NOW() → downgrade plan FREE.';
