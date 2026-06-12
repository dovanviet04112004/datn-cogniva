import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServerOrNull } from '@/lib/api-server';

type PageProps = { params: Promise<{ id: string }> };

export default async function GroupRootPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/sign-in?redirect=${encodeURIComponent(`/groups/${id}`)}`);

  const data = await apiServerOrNull<{ channelId: string | null }>(
    `/api/groups/${id}/first-channel`,
  );
  if (!data) redirect('/groups');
  if (data.channelId) redirect(`/groups/${id}/${data.channelId}`);

  redirect(`/groups/${id}/settings/channels`);
}
