import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';

import { getServerSession } from '@/lib/auth-server';
import { apiServer } from '@/lib/api-server';
import { PageShell } from '@/components/layout/page-shell';
import { CreateGroupDialog } from '@/components/groups/create-group-dialog';
import { JoinGroupDialog } from '@/components/groups/join-group-dialog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function GroupsHubPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/groups');

  const { invite } = await searchParams;

  const { groupId } = await apiServer<{ groupId: string | null }>('/api/groups/latest');

  if (groupId) {
    redirect(`/groups/${groupId}`);
  }

  return (
    <PageShell
      size="default"
      padded
      className="space-y-8"
      eyebrowIcon={Users}
      title="Tham gia nhóm học đầu tiên"
      description="Study Groups gom voice channels + chat realtime + share tài liệu vào một nơi — tạo group mới hoặc nhập mã 6 ký tự."
      action={
        <div className="flex items-center gap-2">
          <JoinGroupDialog initialCode={invite} />
          <CreateGroupDialog />
        </div>
      }
    >
      {null}
    </PageShell>
  );
}
