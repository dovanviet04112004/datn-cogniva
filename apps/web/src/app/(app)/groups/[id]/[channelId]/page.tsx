import { notFound, redirect } from 'next/navigation';

import type { StudyGroupChannel } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { ApiServerError, apiServer } from '@/lib/api-server';

import { ChannelView } from '@/components/groups/channel-view';

type ChannelDto = Omit<StudyGroupChannel, 'createdAt'> & { createdAt: string };

type ChannelResponse = {
  channel: ChannelDto;
  myRole: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
};

type PageProps = { params: Promise<{ id: string; channelId: string }> };

export default async function ChannelPage({ params }: PageProps) {
  const { id, channelId } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/sign-in?redirect=${encodeURIComponent(`/groups/${id}/${channelId}`)}`);

  let data: ChannelResponse;
  try {
    data = await apiServer<ChannelResponse>(`/api/groups/${id}/channels/${channelId}`);
  } catch (err) {
    if (err instanceof ApiServerError && (err.status === 401 || err.status === 403)) {
      redirect('/groups');
    }
    if (err instanceof ApiServerError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <ChannelView
      channel={{ ...data.channel, createdAt: new Date(data.channel.createdAt) }}
      myRole={data.myRole}
      currentUserId={session.user.id}
      currentUserName={session.user.name ?? ''}
      currentUserImage={session.user.image ?? null}
    />
  );
}
