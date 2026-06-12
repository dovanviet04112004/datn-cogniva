import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays, GraduationCap, Plus, UserPlus, Wallet } from 'lucide-react';

import { getServerSession } from '@/lib/auth-server';
import { apiServer } from '@/lib/api-server';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { BookingsManager } from '@/components/tutoring/bookings-manager';
import { MineTab } from '@/components/tutoring/mine-tab';
import { RequestsTab } from '@/components/tutoring/requests-tab';
import { TutoringTabNav, type TutoringTab } from '@/components/tutoring/tab-nav';
import { TutorsTab } from '@/components/tutoring/tutors-tab';
import { ConciergeTrigger } from '@/components/tutoring/concierge/concierge-trigger';
import { ClassesTab } from '@/components/tutoring/classes-tab';
import { FavoritesTab } from '@/components/tutoring/favorites-tab';
import { CompareFloatingCart } from '@/components/tutoring/compare-floating-cart';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{
  tab?: string;
  subject?: string;
  level?: string;
  modality?: string;
  minRate?: string;
  maxRate?: string;
  urgency?: string;
}>;

function normaliseTab(raw: string | undefined): TutoringTab {
  if (
    raw === 'requests' ||
    raw === 'mine' ||
    raw === 'classes' ||
    raw === 'orders' ||
    raw === 'favorites'
  ) {
    return raw;
  }
  return 'tutors';
}

export default async function TutoringHubPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/tutoring');

  const sp = await searchParams;
  const tab = normaliseTab(sp.tab);

  const myProfile =
    (await apiServer<{ id: string; status: string } | null>('/api/tutoring/my-profile')) ?? null;

  return (
    <PageShell size="wide" padded className="space-y-5">
      <PageHero
        eyebrow="Gia sư"
        eyebrowIcon={GraduationCap}
        title="Tutoring Marketplace"
        description="Gia sư · Lớp nhóm · Yêu cầu học"
      >
        <div className="flex items-center gap-2">
          <Link
            href="/wallet"
            title="Ví"
            aria-label="Ví"
            className="border-divider bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors"
          >
            <Wallet className="h-4 w-4" />
          </Link>
          <Link
            href="/tutoring/calendar"
            title="Lịch học"
            aria-label="Lịch học"
            className="border-divider bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors"
          >
            <CalendarDays className="h-4 w-4" />
          </Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/tutoring/requests/new">
              <Plus className="h-3.5 w-3.5" />
              Đăng yêu cầu
            </Link>
          </Button>
          {!myProfile && (
            <Button asChild size="sm">
              <Link href="/tutors/become">
                <UserPlus className="h-3.5 w-3.5" />
                Trở thành gia sư
              </Link>
            </Button>
          )}
        </div>
      </PageHero>

      <ConciergeTrigger variant="searchBar" />

      <TutoringTabNav active={tab} />

      {tab === 'tutors' && <TutorsTab sp={sp} />}
      {tab === 'classes' && <ClassesTab sp={sp} />}
      {tab === 'requests' && <RequestsTab sp={sp} currentUserId={session.user.id} />}
      {tab === 'orders' && <BookingsManager defaultRole="student" showRoleToggle={!!myProfile} />}
      {tab === 'favorites' && <FavoritesTab />}
      {tab === 'mine' && <MineTab />}

      <CompareFloatingCart />
    </PageShell>
  );
}
