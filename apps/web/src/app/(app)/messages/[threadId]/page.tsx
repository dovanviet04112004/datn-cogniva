import { notFound, redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServer, ApiServerError } from '@/lib/api-server';
import { DmChat } from '@/components/dm/dm-chat';

type PageProps = { params: Promise<{ threadId: string }> };

type ThreadResponse = {
  thread: {
    id: string;
    peer: { id: string; name: string | null; image: string | null };
  };
};

export default async function DmThreadPage({ params }: PageProps) {
  const { threadId } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/sign-in?redirect=/messages/${threadId}`);

  let data: ThreadResponse;
  try {
    data = await apiServer<ThreadResponse>(`/api/dm/threads/${threadId}`);
  } catch (err) {
    if (err instanceof ApiServerError && err.status === 404) notFound();
    if (err instanceof ApiServerError && err.status === 403) redirect('/messages');
    throw err;
  }

  return <DmChat threadId={threadId} peer={data.thread.peer} currentUserId={session.user.id} />;
}
