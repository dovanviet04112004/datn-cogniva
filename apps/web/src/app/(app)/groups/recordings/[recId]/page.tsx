import { notFound, redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServerOrNull } from '@/lib/api-server';
import { ReplayClient, type ReplayChapter } from '@/components/rooms/replay-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RecordingDetail = {
  recording: {
    id: string;
    status: string;
    fileUrl: string | null;
    duration: number | null;
    summary: string | null;
    transcript: string | null;
    chapters: ReplayChapter[] | null;
    startedAt: string;
    endedAt: string | null;
  };
  channel: { id: string; groupId: string; name: string };
  groupName: string | null;
  canDelete: boolean;
};

type Props = { params: Promise<{ recId: string }> };

export default async function GroupRecordingReplayPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');
  const { recId } = await params;

  const data = await apiServerOrNull<RecordingDetail>(`/api/channels/recordings/${recId}`);
  if (!data) notFound();

  const { recording, channel, groupName, canDelete } = data;

  if (recording.status === 'RECORDING') {
    redirect(`/groups/${channel.groupId}?channel=${channel.id}`);
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] w-full">
      <ReplayClient
        roomId={channel.id}
        roomName={`${groupName ?? 'Group'} · #${channel.name}`}
        pusherChannelPrefix="presence-voice-"
        syncUrl={`/api/channels/${channel.id}/record/${recording.id}/sync`}
        deleteUrl={`/api/channels/${channel.id}/record/${recording.id}`}
        canDelete={canDelete}
        afterDeleteHref={`/groups/${channel.groupId}?channel=${channel.id}`}
        recording={{
          id: recording.id,
          status: recording.status as 'PROCESSING' | 'PROCESSED' | 'FAILED',
          fileUrl: recording.fileUrl,
          duration: recording.duration,
          summary: recording.summary,
          transcript: recording.transcript,
          chapters: recording.chapters,
          startedAt: recording.startedAt,
          endedAt: recording.endedAt,
        }}
      />
    </div>
  );
}
