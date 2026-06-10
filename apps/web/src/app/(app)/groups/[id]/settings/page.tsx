/**
 * /groups/[id]/settings — group settings shell với tabs.
 *
 * Tabs: Overview | Channels | Members | Invites
 * Mỗi tab là sub-component. ADMIN+ mới được truy cập (server-side check).
 */
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';

import { db, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { GroupSettings } from '@/components/groups/group-settings';

type PageProps = { params: Promise<{ id: string }> };

export default async function GroupSettingsPage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?redirect=${encodeURIComponent(`/groups/${id}/settings`)}`);

  const [member] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, id), eq(studyGroupMember.userId, session.user.id)),
    )
    .limit(1);
  if (!member) redirect('/groups');
  if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
    redirect(`/groups/${id}`);
  }

  return <GroupSettings groupId={id} myRole={member.role} currentUserId={session.user.id} />;
}
