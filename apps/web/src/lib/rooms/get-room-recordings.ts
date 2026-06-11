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

export async function getRoomRecordings(roomId: string): Promise<RoomRecordingRow[]> {
  const rows = await cached(ck.roomRecordings(roomId), 600, () => fetchRoomRecordings(roomId));
  return rows.map((r) => ({ ...r, startedAt: new Date(r.startedAt) }));
}

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
