/**
 * /tutoring — unified Tutoring Marketplace hub.
 *
 * 1 entry point trong sidebar, 3 tab nội bộ:
 *   - ?tab=tutors    → browse gia sư (default)
 *   - ?tab=requests  → browse yêu cầu học sinh
 *   - ?tab=mine      → personal dashboard (profile + my apps + my requests)
 *
 * Hero band cố định ở trên, tab content swap bên dưới. Filter giữ scope per tab.
 *
 * Server component — fetch trực tiếp Drizzle thay qua /api để SSR nhanh.
 */
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { CalendarDays, GraduationCap, Plus, UserPlus, Wallet } from 'lucide-react';

import { db, tutorProfile } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { BookingsManager } from '@/components/tutoring/bookings-manager';
import { MineTab } from '@/components/tutoring/mine-tab';
import { RequestsTab } from '@/components/tutoring/requests-tab';
import {
  TutoringTabNav,
  type TutoringTab,
} from '@/components/tutoring/tab-nav';
import { TutorsTab } from '@/components/tutoring/tutors-tab';
// V4 T1: AI Concierge search trigger
import { ConciergeTrigger } from '@/components/tutoring/concierge/concierge-trigger';
// V4 T4+T5: classes + favorites tab content + compare cart
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

export default async function TutoringHubPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?redirect=/tutoring');

  const sp = await searchParams;
  const tab = normaliseTab(sp.tab);

  // Check user đã có tutor profile chưa — quyết định CTA hero
  const [myProfile] = await db
    .select({ id: tutorProfile.id, status: tutorProfile.status })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);

  return (
    <PageShell size="wide" padded className="space-y-5">
      {/* Hero CHUNG — đồng bộ ngôn ngữ banner với mọi hub. Icon chip cũ →
          eyebrowIcon, h1 → title, p mô tả → description, cụm nút → children. */}
      <PageHero
        eyebrow="Gia sư"
        eyebrowIcon={GraduationCap}
        title="Tutoring Marketplace"
        description="Gia sư · Lớp nhóm · Yêu cầu học"
      >
        <div className="flex items-center gap-2">
          {/* Phụ trợ — icon gọn để khỏi chen chữ */}
          <Link
            href="/wallet"
            title="Ví"
            aria-label="Ví"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-divider bg-card text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            <Wallet className="h-4 w-4" />
          </Link>
          <Link
            href="/tutoring/calendar"
            title="Lịch học"
            aria-label="Lịch học"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-divider bg-card text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            <CalendarDays className="h-4 w-4" />
          </Link>
          {/* Đăng yêu cầu — nút phụ (outline) → dùng <Button variant="outline"> */}
          <Button asChild variant="outline" size="sm">
            <Link href="/tutoring/requests/new">
              <Plus className="h-3.5 w-3.5" />
              Đăng yêu cầu
            </Link>
          </Button>
          {/* Tutor: bỏ nút "Bảng gia sư" vì trùng tab "Tổng quan" (?tab=mine).
              Non-tutor: giữ CTA trở thành gia sư (primary → <Button> mặc định). */}
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

      {/* V4 T1: AI Concierge search bar — accent-discovery glow */}
      <ConciergeTrigger variant="searchBar" />

      {/* V4: Tab nav — 5 tab horizontal scroll */}
      <TutoringTabNav active={tab} />

      {/* ══ Tab content ════════════════════════════════════ */}
      {tab === 'tutors' && <TutorsTab sp={sp} />}
      {tab === 'classes' && <ClassesTab sp={sp} />}
      {tab === 'requests' && (
        <RequestsTab sp={sp} currentUserId={session.user.id} />
      )}
      {tab === 'orders' && (
        <BookingsManager defaultRole="student" showRoleToggle={!!myProfile} />
      )}
      {tab === 'favorites' && <FavoritesTab />}
      {tab === 'mine' && <MineTab userId={session.user.id} />}

      {/* V4 T5: floating compare cart (chỉ hiện khi cart ≥ 1) */}
      <CompareFloatingCart />
    </PageShell>
  );
}
