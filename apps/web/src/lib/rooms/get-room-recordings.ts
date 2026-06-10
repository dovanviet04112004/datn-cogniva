/**
 * getRoomRecordings — list recording của 1 room (server-only).
 *
 * Tách khỏi page recordings (trước inline query) làm 1 nguồn dùng chung + cache được.
 * Cache-aside Redis (TTL 600s): list recording đổi CHẬM (chỉ thêm khi 1 buổi học
 * được ghi xong và worker BullMQ finalize). Invalidate: `onRoomRecordingsChanged(roomId)`
 * gọi tại choke point finalize trong process-recording (lúc persist).
 *
 * CHUNG mọi member của room → cache theo roomId (ck.roomRecordings), KHÔNG kèm userId.
 * Membership guard (member ACTIVE?) PHẢI ở NGOÀI cache (page tự check) — cache chỉ
 * chứa data thô, không chứa quyết định quyền.
 *
 * dbReplica: read thuần list (không read-your-own-write tức thì) → route replica
 * giảm tải primary (fallback primary nếu replica lỗi).
 *
 * Date-serialization: `startedAt` (timestamp notNull) là Date thật → page render
 * qua `new Date(...).toLocaleString('vi-VN')`. Re-hydrate Date sau cache để giữ type
 * honest (qua JSON.stringify trong cache nó thành string, không re-hydrate sẽ type-lie).
 */
import { desc, eq } from 'drizzle-orm';

import { dbReplica, recording } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export type RoomRecordingRow = {
  id: string;
  status: string;
  duration: number | null;
  summary: string | null;
  startedAt: Date;
};

/** Bản CACHE (TTL 600s) + re-hydrate Date. roomId — guard membership NGOÀI hàm này. */
export async function getRoomRecordings(roomId: string): Promise<RoomRecordingRow[]> {
  const rows = await cached(ck.roomRecordings(roomId), 600, () => fetchRoomRecordings(roomId));
  // startedAt qua cache thành string → re-hydrate về Date cho consumer.
  return rows.map((r) => ({ ...r, startedAt: new Date(r.startedAt) }));
}

/** Truy vấn thật — chỉ chạy khi cache MISS. Read thuần → dbReplica. */
async function fetchRoomRecordings(roomId: string): Promise<RoomRecordingRow[]> {
  return dbReplica
    .select({
      id: recording.id,
      status: recording.status,
      duration: recording.duration,
      summary: recording.summary,
      startedAt: recording.startedAt,
    })
    .from(recording)
    .where(eq(recording.roomId, roomId))
    .orderBy(desc(recording.startedAt))
    .limit(50);
}
