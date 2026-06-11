import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';

import { db, studyGroupChannel, studyGroupMember } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';

type PageProps = { params: Promise<{ id: string }> };

export default async function GroupRootPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/sign-in?redirect=${encodeURIComponent(`/groups/${id}`)}`);

  const [member] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(and(eq(studyGroupMember.groupId, id), eq(studyGroupMember.userId, session.user.id)))
    .limit(1);
  if (!member) redirect('/groups');

  const [textCh] = await db
    .select({ id: studyGroupChannel.id })
    .from(studyGroupChannel)
    .where(and(eq(studyGroupChannel.groupId, id), eq(studyGroupChannel.type, 'TEXT')))
    .orderBy(asc(studyGroupChannel.position), asc(studyGroupChannel.createdAt))
    .limit(1);
  if (textCh) redirect(`/groups/${id}/${textCh.id}`);

  const [anyCh] = await db
    .select({ id: studyGroupChannel.id })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.groupId, id))
    .orderBy(asc(studyGroupChannel.position), asc(studyGroupChannel.createdAt))
    .limit(1);
  if (anyCh) redirect(`/groups/${id}/${anyCh.id}`);

  redirect(`/groups/${id}/settings/channels`);
}
