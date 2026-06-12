import { redirect } from 'next/navigation';

import type { StudyGroup, StudyGroupChannel } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { apiServerOrNull } from '@/lib/api-server';
import { GroupShell } from '@/components/groups/group-shell';

type GroupDto = Omit<StudyGroup, 'createdAt' | 'suspendedAt'> & {
  createdAt: string;
  suspendedAt: string | null;
};

type ChannelDto = Omit<StudyGroupChannel, 'createdAt'> & { createdAt: string };

type ShellResponse = {
  group: GroupDto;
  channels: ChannelDto[];
  categories: { id: string; name: string; position: number }[];
  myGroups: { id: string; name: string; iconUrl: string | null }[];
  myRole: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
};

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

  const data = await apiServerOrNull<ShellResponse>(`/api/groups/${id}/shell`);
  if (!data) redirect('/groups');

  return (
    <GroupShell
      group={{
        ...data.group,
        createdAt: new Date(data.group.createdAt),
        suspendedAt: data.group.suspendedAt ? new Date(data.group.suspendedAt) : null,
      }}
      channels={data.channels.map((c) => ({ ...c, createdAt: new Date(c.createdAt) }))}
      categories={data.categories}
      myGroups={data.myGroups}
      myRole={data.myRole}
      activeGroupId={id}
      currentUserId={session.user.id}
    >
      {children}
    </GroupShell>
  );
}
