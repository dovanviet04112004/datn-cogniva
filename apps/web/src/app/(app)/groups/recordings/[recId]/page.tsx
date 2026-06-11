/**
 * /groups/recordings/[recId] — Replay page cho 1 voice channel recording.
 *
 * Server component:
 *   1. Auth + verify user là member của studyGroup chứa channel (chống IDOR).
 *   2. Load recording row + channel name + group meta.
 *   3. Render ReplayClient (reuse từ rooms — UI giống hệt).
 *
 * URL pattern: /groups/recordings/{id} — chỉ cần recordingId, không cần
 * channelId trong path vì PK đủ unique. System message AI Tutor trong channel
 * link đến route này (xem process-recording.ts).
 */
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import {
  db,
  recording,
  studyGroup,
  studyGroupChannel,
  studyGroupMember,
} from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { ReplayClient } from '@/components/rooms/replay-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ recId: string }> };

export default async function GroupRecordingReplayPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');
  const { recId } = await params;

  const [rec] = await db
    .select()
    .from(recording)
    .where(eq(recording.id, recId))
    .limit(1);
  if (!rec || !rec.studyGroupChannelId) notFound();

  // Verify member của group chứa channel
  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId, name: studyGroupChannel.name })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, rec.studyGroupChannelId))
    .limit(1);
  if (!ch) notFound();

  const [member] = await db
    .select({ id: studyGroupMember.id, role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) notFound();
  const canDelete = ['OWNER', 'ADMIN', 'MODERATOR'].includes(member.role);

  const [group] = await db
    .select({ name: studyGroup.name })
    .from(studyGroup)
    .where(eq(studyGroup.id, ch.groupId))
    .limit(1);

  // Recording chưa kết thúc → quay lại channel
  if (rec.status === 'RECORDING') {
    redirect(`/groups/${ch.groupId}?channel=${rec.studyGroupChannelId}`);
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] w-full">
      <ReplayClient
        roomId={rec.studyGroupChannelId}
        roomName={`${group?.name ?? 'Group'} · #${ch.name}`}
        pusherChannelPrefix="presence-voice-"
        syncUrl={`/api/channels/${rec.studyGroupChannelId}/record/${rec.id}/sync`}
        deleteUrl={`/api/channels/${rec.studyGroupChannelId}/record/${rec.id}`}
        canDelete={canDelete}
        afterDeleteHref={`/groups/${ch.groupId}?channel=${rec.studyGroupChannelId}`}
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
