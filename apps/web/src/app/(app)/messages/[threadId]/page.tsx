import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db, dmThread, user as userTable } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { isThreadMember } from '@/lib/group/dm';
import { DmChat } from '@/components/dm/dm-chat';

type PageProps = { params: Promise<{ threadId: string }> };

export default async function DmThreadPage({ params }: PageProps) {
  const { threadId } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/sign-in?redirect=/messages/${threadId}`);

  const [thread] = await db.select().from(dmThread).where(eq(dmThread.id, threadId)).limit(1);
  if (!thread) notFound();
  if (!isThreadMember(thread, session.user.id)) redirect('/messages');

  const peerId = thread.user1Id === session.user.id ? thread.user2Id : thread.user1Id;
  const [peer] = await db
    .select({ id: userTable.id, name: userTable.name, image: userTable.image })
    .from(userTable)
    .where(eq(userTable.id, peerId))
    .limit(1);

  return (
    <DmChat
      threadId={threadId}
      peer={peer ?? { id: peerId, name: 'Unknown', image: null }}
      currentUserId={session.user.id}
    />
  );
}
