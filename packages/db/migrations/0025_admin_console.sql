-- Phase 0 (Admin Console) — schema cho trang quản trị tách biệt.
-- Spec: docs/plans/admin.md §6.1.
--
-- 4 thay đổi:
--   1. user.admin_role     — phân quyền 3 cấp admin (NULL = user thường)
--   2. user.suspended_at   — soft suspend, giữ data
--   3. admin_audit_log     — log mọi mutation admin (ai/làm gì/khi nào)
--   4. content_report      — queue báo cáo content do user khác submit
--   5. system_config       — singleton key-value cho maintenance/banner/flags

-- ── 1+2. user table ─────────────────────────────────────────
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS admin_role TEXT
    CHECK (admin_role IS NULL OR admin_role IN ('SUPER_ADMIN','ADMIN','SUPPORT')),
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspend_reason TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_user_admin_role ON "user"(admin_role)
  WHERE admin_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_suspended ON "user"(suspended_at)
  WHERE suspended_at IS NOT NULL;

-- ── 3. admin_audit_log ─────────────────────────────────────
-- Mọi mutation từ admin endpoint phải sinh 1 row qua helper withAudit().
-- payload chứa { before, after, reason } — diff JSON để DiffViewer render.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_log(action, created_at DESC);

-- ── 4. content_report ─────────────────────────────────────
-- User flag content khác (message/user/review/document). Admin xử lý queue.
CREATE TABLE IF NOT EXISTS content_report (
  id            TEXT PRIMARY KEY,
  reporter_id   TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  target_type   TEXT NOT NULL
    CHECK (target_type IN ('message','user','review','document','group')),
  target_id     TEXT NOT NULL,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','RESOLVED','DISMISSED')),
  resolved_by   TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  resolved_at   TIMESTAMPTZ,
  resolution    TEXT
    CHECK (resolution IS NULL OR resolution IN ('dismiss','takedown','warn','ban')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index — chỉ index PENDING (90% query là queue view)
CREATE INDEX IF NOT EXISTS idx_report_pending ON content_report(created_at DESC)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_report_target
  ON content_report(target_type, target_id);

-- ── 5. system_config ─────────────────────────────────────
-- Singleton key-value cho maintenance mode, banner, feature flags inline edit.
CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed maintenance config — disable by default.
INSERT INTO system_config (key, value)
VALUES ('maintenance', '{"enabled": false, "banner": null, "dismissible": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;
