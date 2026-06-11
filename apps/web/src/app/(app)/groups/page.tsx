import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { Users } from 'lucide-react';

import { db, studyGroup, studyGroupMember } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { CreateGroupDialog } from '@/components/groups/create-group-dialog';
import { JoinGroupDialog } from '@/components/groups/join-group-dialog';
import { NeuralPattern } from '@/components/ui/neural-pattern';

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

  const [latest] = await db
    .select({ groupId: studyGroupMember.groupId })
    .from(studyGroupMember)
    .innerJoin(studyGroup, eq(studyGroup.id, studyGroupMember.groupId))
    .where(eq(studyGroupMember.userId, session.user.id))
    .orderBy(desc(studyGroupMember.joinedAt))
    .limit(1);

  if (latest) {
    redirect(`/groups/${latest.groupId}`);
  }

  return (
    <PageShell size="default" padded className="space-y-8">
      <PageHero
        eyebrow="Community"
        eyebrowIcon={Users}
        title="Tham gia nhóm học đầu tiên"
        description="Study Groups gom voice channels + chat realtime + share tài liệu vào một nơi. Tạo group mới cho lớp/dự án, hoặc tham gia bằng mã 6 ký tự do thành viên khác cấp."
        decoration={
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.14] [mask-image:radial-gradient(ellipse_at_center,_black_30%,_transparent_75%)]"
          >
            <NeuralPattern className="text-primary" />
          </div>
        }
      >
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <JoinGroupDialog initialCode={invite} />
          <CreateGroupDialog />
        </div>
      </PageHero>
    </PageShell>
  );
}
