-- Migration 0042 — V4 T3: VND Wallet + Lesson Packs + Promo Codes.
--
-- Spec: docs/plans/tutoring-v4.md §3 T3.
--
-- 5 tables:
--   1. user_wallet — balance + auto-topup config (1-1 per user)
--   2. user_wallet_txn — ledger audit (immutable rows)
--   3. tutoring_pack — tutor đăng pack 4/8/12 buổi giảm giá
--   4. tutoring_pack_purchase — student mua pack + installment + recurring
--   5. promo_code + promo_code_redemption
--
-- Booking link: tutoring_booking.pack_purchase_id (FK) — buổi học trừ dần pack.

BEGIN;

-- ─── 1. Wallet account ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_wallet (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  balance_vnd integer NOT NULL DEFAULT 0 CHECK (balance_vnd >= 0),
  /** Cashback / promo credit có expiry (không rút được). */
  promo_balance_vnd integer NOT NULL DEFAULT 0 CHECK (promo_balance_vnd >= 0),
  promo_expires_at timestamp,
  /** Auto-topup config: khi balance < threshold → charge amount qua VNPay. */
  auto_topup_threshold_vnd integer,
  auto_topup_amount_vnd integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ─── 2. Wallet ledger ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_wallet_txn (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'TOPUP', 'BOOKING_PAY', 'PACK_PURCHASE', 'REFUND',
    'CASHBACK', 'PROMO', 'PAYOUT_RECEIVED', 'ADJUSTMENT'
  )),
  /** signed: + nạp / - chi. */
  amount_vnd integer NOT NULL,
  balance_after_vnd integer NOT NULL,
  /** Loose FK — booking, topup payment, refund, … */
  related_id text,
  related_type text,
  description text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_wallet_txn_user_time_idx
  ON user_wallet_txn (user_id, created_at DESC);

-- ─── 3. Lesson pack ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutoring_pack (
  id text PRIMARY KEY,
  tutor_id text NOT NULL REFERENCES tutor_profile(id) ON DELETE CASCADE,
  subject_slug text NOT NULL,
  level text NOT NULL,
  session_count integer NOT NULL CHECK (session_count IN (4, 8, 12, 16, 24)),
  duration_min integer NOT NULL DEFAULT 60,
  rate_per_session_vnd integer NOT NULL CHECK (rate_per_session_vnd > 0),
  total_vnd integer NOT NULL CHECK (total_vnd > 0),
  /** So với hourly_rate × session_count gốc. */
  discount_pct integer NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 50),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  description text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tutoring_pack_tutor_idx
  ON tutoring_pack (tutor_id, status);

-- ─── 4. Pack purchase ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutoring_pack_purchase (
  id text PRIMARY KEY,
  pack_id text NOT NULL REFERENCES tutoring_pack(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  /** Snapshot pack info — pack có thể update sau khi student mua. */
  total_vnd integer NOT NULL,
  remaining_sessions integer NOT NULL,
  /** Installment: 2/3/4 kỳ hoặc null nếu trả full. */
  installment_total_periods integer CHECK (installment_total_periods BETWEEN 2 AND 4),
  installment_paid_periods integer NOT NULL DEFAULT 0,
  /** Cron-like: "WEEKLY:TUE:19:00" hoặc null = manual book. */
  recurring_schedule text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'ACTIVE', 'EXHAUSTED', 'REFUNDED', 'EXPIRED', 'DEFAULTED'
  )),
  expires_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tutoring_pack_purchase_student_idx
  ON tutoring_pack_purchase (student_id, status);

-- Link booking với pack purchase
ALTER TABLE tutoring_booking
  ADD COLUMN IF NOT EXISTS pack_purchase_id text
    REFERENCES tutoring_pack_purchase(id) ON DELETE SET NULL;

-- ─── 5. Promo codes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_code (
  code text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('PERCENTAGE', 'FIXED_VND', 'WALLET_CREDIT')),
  /** Giá trị: PERCENTAGE 0-100 / FIXED_VND in VND / WALLET_CREDIT in VND. */
  value integer NOT NULL CHECK (value > 0),
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL DEFAULT 1,
  min_purchase_vnd integer,
  valid_from timestamp,
  valid_until timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_code_redemption (
  promo_code text REFERENCES promo_code(code) ON DELETE CASCADE,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  amount_vnd integer NOT NULL DEFAULT 0,
  redeemed_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (promo_code, user_id)
);

COMMIT;
