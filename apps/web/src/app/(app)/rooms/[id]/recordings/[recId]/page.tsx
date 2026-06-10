/**
 * /rooms/[id]/recordings/[recId] — Replay page cho 1 buổi học đã ghi.
 *
 * Server component:
 *   1. Auth + verify user là member ACTIVE của room (chống IDOR — user khác
 *      không vào được URL replay).
 *   2. Load recording row + room name.
 *   3. Render ReplayClient (video + transcript + chapters).
 *
 * Trạng thái recording:
 *   - RECORDING : chưa kết thúc → redirect về room (replay chưa có video).
 *   - PROCESSING: video sẵn nhưng chưa có transcript/summary → hiển thị
 *     placeholder + auto refresh khi worker BullMQ xong.
 *   - PROCESSED : full UI có transcript + chapters + summary.
 *   - FAILED    : hiển thị video + thông báo "Transcribe lỗi, không có
 *     transcript". Mod có thể trigger re-process Phase 16.
 */
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db, recording, room, roomMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { ReplayClient } from '@/components/rooms/replay-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string; recId: string }> };

export default async function ReplayPage({ params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const { id: roomId, recId } = await params;

  // Verify member ACTIVE
  const [member] = await db
    .select()
    .from(roomMember)
    .where(
      and(
        eq(roomMember.roomId, roomId),
        eq(roomMember.userId, session.user.id),
        eq(roomMember.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  if (!member) notFound();

  const [rec] = await db
    .select()
    .from(recording)
    .where(and(eq(recording.id, recId), eq(recording.roomId, roomId)))
    .limit(1);
  if (!rec) notFound();

  const [roomRow] = await db
    .select({ name: room.name })
    .from(room)
    .where(eq(room.id, roomId))
    .limit(1);

  // Recording chưa kết thúc → quay lại room (live)
  if (rec.status === 'RECORDING') {
    redirect(`/rooms/${roomId}`);
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] w-full">
      <ReplayClient
        roomId={roomId}
        roomName={roomRow?.name ?? 'Room'}
        recording={{
          id: rec.id,
          status: rec.status as 'PROCESSING' | 'PROCESSED' | 'FAILED',
          fileUrl: rec.fileUrl,
          duration: rec.duration,
          summary: rec.summary,
          transcript: rec.transcript,
          chapters: rec.chapters as Array<{
            startSec: number;
            endSec: number;
            title: string;
            preview: string;
          }> | null,
          startedAt: rec.startedAt.toISOString(),
          endedAt: rec.endedAt ? rec.endedAt.toISOString() : null,
        }}
      />
    </div>
  );
}
