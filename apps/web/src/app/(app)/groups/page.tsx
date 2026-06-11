/**
 * /groups — group hub entry.
 *
 * Logic:
 *   - User có 1+ group → redirect THẲNG vào group gần nhất (kết hợp với
 *     /groups/[id] auto pick first channel → user landing trực tiếp vào
 *     conversation, không phải qua "list page" rồi click thêm).
 *   - User 0 group → render onboarding (Create + Join CTA) — không có
 *     list rỗng vô nghĩa.
 *
 * Trước đây có grid card liệt kê 2-3 group nhưng đó là extra click cho
 * use case 99% (user vào group quen). Switch group qua sidebar trong
 * group detail.
 */
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { Users } from 'lucide-react';

import { db, studyGroup, studyGroupMember } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { PageShell } from '@/components/layout/page-shell';
// Hero band CHUNG — thay onboarding header tự-chế để đồng bộ ngôn ngữ hero toàn app.
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

  // Link mời `/groups?invite=CODE` → mở sẵn dialog vào group + điền code.
  const { invite } = await searchParams;

  // Lấy group gần nhất user đã join — ưu tiên theo joinedAt mới nhất.
  // Limit 1 vì chỉ cần để redirect, không cần list.
  const [latest] = await db
    .select({ groupId: studyGroupMember.groupId })
    .from(studyGroupMember)
    .innerJoin(studyGroup, eq(studyGroup.id, studyGroupMember.groupId))
    .where(eq(studyGroupMember.userId, session.user.id))
    .orderBy(desc(studyGroupMember.joinedAt))
    .limit(1);

  // Có group → đi thẳng (group detail tự pick channel mặc định)
  if (latest) {
    redirect(`/groups/${latest.groupId}`);
  }

  // 0 group → onboarding panel với Create + Join CTAs
  return (
    <PageShell size="default" padded className="space-y-8">
      {/* Hero band CHUNG — giữ motif NeuralPattern onboarding qua decoration; CTA → children. */}
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
        {/* GIỮ nguyên CTA Create + Join (logic/link không đổi). */}
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <JoinGroupDialog initialCode={invite} />
          <CreateGroupDialog />
        </div>
      </PageHero>
    </PageShell>
  );
}
