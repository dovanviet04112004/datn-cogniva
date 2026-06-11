import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db, studyGroupChannel, studyGroupMember } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';

import { ChannelView } from '@/components/groups/channel-view';

type PageProps = { params: Promise<{ id: string; channelId: string }> };

export default async function ChannelPage({ params }: PageProps) {
  const { id, channelId } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/sign-in?redirect=${encodeURIComponent(`/groups/${id}/${channelId}`)}`);

  const [member] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(and(eq(studyGroupMember.groupId, id), eq(studyGroupMember.userId, session.user.id)))
    .limit(1);
  if (!member) redirect('/groups');

  const [channel] = await db
    .select()
    .from(studyGroupChannel)
    .where(and(eq(studyGroupChannel.id, channelId), eq(studyGroupChannel.groupId, id)))
    .limit(1);
  if (!channel) notFound();

  return (
    <ChannelView
      channel={channel}
      myRole={member.role}
      currentUserId={session.user.id}
      currentUserName={session.user.name ?? ''}
      currentUserImage={session.user.image ?? null}
    />
  );
}
