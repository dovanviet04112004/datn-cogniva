/**
 * Layout 3-column Discord-style cho 1 group.
 *
 * Col 1 (60px)  : GroupSidebar — list groups user joined (icons only)
 * Col 2 (240px) : ChannelList — group header + channels TEXT/VOICE
 * Col 3 (flex)  : children — channel view (TEXT chat hoặc VOICE)
 * Col 4 (240px) : MemberSidebar — render qua context bên trong children (mobile collapse)
 *
 * Layout này wrap mọi route `/groups/[id]/...` để menu trái luôn hiện.
 */
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';

import {
  db,
  studyGroup,
  studyGroupCategory,
  studyGroupChannel,
  studyGroupMember,
} from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { GroupShell } from '@/components/groups/group-shell';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export default async function GroupLayout({ children, params }: LayoutProps) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) {
    redirect(`/sign-in?redirect=${encodeURIComponent(`/groups/${id}`)}`);
  }

  // Verify membership server-side trước khi render
  const [member] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, id), eq(studyGroupMember.userId, session.user.id)),
    )
    .limit(1);
  if (!member) redirect('/groups');

  // Load group meta + channels cho sidebar
  const [group] = await db
    .select()
    .from(studyGroup)
    .where(eq(studyGroup.id, id))
    .limit(1);
  if (!group) redirect('/groups');

  const [channels, categories, myGroups] = await Promise.all([
    db
      .select()
      .from(studyGroupChannel)
      .where(eq(studyGroupChannel.groupId, id))
      .orderBy(asc(studyGroupChannel.position), asc(studyGroupChannel.createdAt)),
    db
      .select()
      .from(studyGroupCategory)
      .where(eq(studyGroupCategory.groupId, id))
      .orderBy(asc(studyGroupCategory.position), asc(studyGroupCategory.createdAt)),
    db
      .select({
        id: studyGroup.id,
        name: studyGroup.name,
        iconUrl: studyGroup.iconUrl,
      })
      .from(studyGroup)
      .innerJoin(studyGroupMember, eq(studyGroupMember.groupId, studyGroup.id))
      .where(eq(studyGroupMember.userId, session.user.id)),
  ]);

  return (
    <GroupShell
      group={group}
      channels={channels}
      categories={categories}
      myGroups={myGroups}
      myRole={member.role}
      activeGroupId={id}
      currentUserId={session.user.id}
    >
      {children}
    </GroupShell>
  );
}
