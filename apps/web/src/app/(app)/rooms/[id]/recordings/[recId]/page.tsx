import { notFound, redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServerOrNull } from '@/lib/api-server';
import { ReplayClient } from '@/components/rooms/replay-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string; recId: string }> };

type RecordingDetail = {
  recording: {
    id: string;
    status: string;
    fileUrl: string | null;
    duration: number | null;
    summary: string | null;
    transcript: string | null;
    chapters: Array<{
      startSec: number;
      endSec: number;
      title: string;
      preview: string;
    }> | null;
    startedAt: string;
    endedAt: string | null;
  };
  roomName: string | null;
};

export default async function ReplayPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');
  const { id: roomId, recId } = await params;

  const res = await apiServerOrNull<RecordingDetail>(`/api/rooms/${roomId}/record/${recId}`);
  if (!res) notFound();
  const rec = res.recording;

  if (rec.status === 'RECORDING') {
    redirect(`/rooms/${roomId}`);
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] w-full">
      <ReplayClient
        roomId={roomId}
        roomName={res.roomName ?? 'Room'}
        recording={{
          id: rec.id,
          status: rec.status as 'PROCESSING' | 'PROCESSED' | 'FAILED',
          fileUrl: rec.fileUrl,
          duration: rec.duration,
          summary: rec.summary,
          transcript: rec.transcript,
          chapters: rec.chapters,
          startedAt: rec.startedAt,
          endedAt: rec.endedAt,
        }}
      />
    </div>
  );
}
