import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db, recording, room, roomMember } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { ReplayClient } from '@/components/rooms/replay-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string; recId: string }> };

export default async function ReplayPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');
  const { id: roomId, recId } = await params;

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
