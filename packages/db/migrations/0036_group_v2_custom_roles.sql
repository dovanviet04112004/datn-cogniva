-- Migration 0036 — Study Group V2 G1: Custom roles + per-channel permission overrides.
--
-- Phase: docs/plans/study-group-v2.md §G1
--
-- Thay đổi:
--   1. Tạo bảng study_group_role — custom role per group (name + color + position
--      + permissions JSONB + hoisted + mentionable + legacy_role link).
--   2. Tạo bảng study_group_member_role — many-to-many member ↔ role.
--   3. Tạo bảng study_group_channel_permission — per-channel override (role hoặc user).
--   4. Backfill default roles cho mọi group hiện có (OWNER/ADMIN/MODERATOR/MEMBER)
--      với is_managed=true (không xoá được). legacy_role link giữ backward-compat.
--   5. Backfill member_role rows từ studyGroupMember.role hiện tại.
--
-- Backward-compat: cột studyGroupMember.role vẫn giữ — `can()` helper cũ
-- vẫn dùng được. Code mới gọi `effectivePermissions()` sẽ join qua bảng mới.

BEGIN;

-- 1. study_group_role
CREATE TABLE IF NOT EXISTS study_group_role (
  id text PRIMARY KEY,
  group_id text NOT NULL REFERENCES study_group(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#9aa3af',
  position integer NOT NULL DEFAULT 0,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  hoisted boolean NOT NULL DEFAULT false,
  mentionable boolean NOT NULL DEFAULT false,
  is_managed boolean NOT NULL DEFAULT false,
  legacy_role text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS study_group_role_group_position_idx
  ON study_group_role (group_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS study_group_role_group_name_uniq
  ON study_group_role (group_id, name);

-- 2. study_group_member_role
CREATE TABLE IF NOT EXISTS study_group_member_role (
  member_id text NOT NULL REFERENCES study_group_member(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES study_group_role(id) ON DELETE CASCADE,
  assigned_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, role_id)
);

CREATE INDEX IF NOT EXISTS study_group_member_role_role_idx
  ON study_group_member_role (role_id);

-- 3. study_group_channel_permission
CREATE TABLE IF NOT EXISTS study_group_channel_permission (
  id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES study_group_channel(id) ON DELETE CASCADE,
  role_id text REFERENCES study_group_role(id) ON DELETE CASCADE,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  -- Constraint: exactly 1 trong (role_id, user_id) phải set
  CHECK ((role_id IS NULL) <> (user_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS study_group_chperm_role_uniq
  ON study_group_channel_permission (channel_id, role_id)
  WHERE role_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS study_group_chperm_user_uniq
  ON study_group_channel_permission (channel_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS study_group_chperm_channel_idx
  ON study_group_channel_permission (channel_id);

-- 4. Backfill default roles cho mọi group hiện có.
--    Generate uuid-like id qua gen_random_uuid()::text (pgcrypto đã có sẵn).
--
--    Position layout: OWNER=100, ADMIN=75, MOD=50, MEMBER=10 — match ROLE_RANK.
--
--    Permissions JSON: tạm để '{}' empty — runtime `effectivePermissions()`
--    fallback về legacy `can()` matrix nếu role là managed + legacy_role set.
--    Sau khi UI Roles tab ship, user có thể edit permissions explicit.
INSERT INTO study_group_role (id, group_id, name, color, position, permissions, hoisted, mentionable, is_managed, legacy_role)
SELECT
  gen_random_uuid()::text,
  g.id,
  legacy_def.name,
  legacy_def.color,
  legacy_def.position,
  '{}'::jsonb,
  legacy_def.hoisted,
  false,
  true,
  legacy_def.legacy
FROM study_group g
CROSS JOIN (
  VALUES
    ('Chủ nhóm',  '#f59e0b', 100, true,  'OWNER'),
    ('Quản trị',  '#ef4444', 75,  true,  'ADMIN'),
    ('Điều hành', '#3b82f6', 50,  true,  'MODERATOR'),
    ('Thành viên','#9aa3af', 10,  false, 'MEMBER')
) AS legacy_def(name, color, position, hoisted, legacy)
ON CONFLICT (group_id, name) DO NOTHING;

-- 5. Backfill member_role: link mỗi member với role tương ứng legacy_role.
INSERT INTO study_group_member_role (member_id, role_id)
SELECT
  m.id,
  r.id
FROM study_group_member m
INNER JOIN study_group_role r
  ON r.group_id = m.group_id
  AND r.legacy_role = m.role::text
ON CONFLICT (member_id, role_id) DO NOTHING;

COMMIT;
