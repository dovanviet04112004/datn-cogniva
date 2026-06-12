import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServerOrNull } from '@/lib/api-server';
import { GroupSettings } from '@/components/groups/group-settings';

type PageProps = { params: Promise<{ id: string }> };

export default async function GroupSettingsPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/sign-in?redirect=${encodeURIComponent(`/groups/${id}/settings`)}`);

  const data = await apiServerOrNull<{ role: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER' }>(
    `/api/groups/${id}/member-role`,
  );
  if (!data) redirect('/groups');
  if (data.role !== 'OWNER' && data.role !== 'ADMIN') {
    redirect(`/groups/${id}`);
  }

  return <GroupSettings groupId={id} myRole={data.role} currentUserId={session.user.id} />;
}
