-- =============================================================================
-- Migration 0018 — Recording storage_key (Phase 20 V3 fix)
-- =============================================================================
-- LiveKit egress metadata bị ephemeral trên Cloud — listEgress() có thể không
-- return `fileResults[0].filename` sau vài phút. App phải tự lưu storage key
-- ngay khi gọi startRoomCompositeEgress() vì WE generate filepath.
--
-- `storage_key` format: `recordings/group/{channelId}/{ts}.mp4` (channel) hoặc
--                       `recordings/{roomId}/{ts}.mp4` (room)
-- Public URL = R2_PUBLIC_URL + '/' + storage_key
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0018_recording_storage_key.sql
-- =============================================================================

ALTER TABLE "recording"
  ADD COLUMN "storage_key" text;
