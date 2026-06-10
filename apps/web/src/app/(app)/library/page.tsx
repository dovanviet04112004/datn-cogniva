/**
 * /library — Library Hub V1 (2026-05-22).
 *
 * AI-first discovery: hero search bar với 3 quick mode (Goal / Reverse / Concierge).
 * Browse theo môn + filter detail + grid 24 docs/page.
 *
 * Reuse: Pagination + ListToolbar pattern từ tutoring V5.
 */
import { Suspense } from 'react';
import {
  Compass,
  Crown,
  FileText,
  Library as LibraryIcon,
  Layers,
  Upload,
} from 'lucide-react';

import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { isUserPro } from '@/lib/library/access';
import { getLibraryHubStats } from '@/lib/library/get-hub-stats';
import { getServerT } from '@/lib/i18n/server';

import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

import { HubCuratedSections } from '@/components/library/hub-curated-sections';
import { LibraryGrid } from '@/components/library/library-grid';
import { RecentlyViewed } from '@/components/library/recently-viewed';
import { SavedSearchBar } from '@/components/library/saved-search-bar';
import { UnifiedSearch } from '@/components/library/unified-search';

export const dynamic = 'force-dynamic';

type SearchParams = {
  q?: string;
  subject?: string;
  level?: string;
  grade?: string;
  docType?: string;
  language?: string;
  fileFormat?: string;
  difficulty?: string;
  university?: string;
  course?: string;
  sort?: string;
  page?: string;
  per?: string;
};

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  // Detect active filter để ẩn curated sections khi user đang search
  const hasActiveSearch = Boolean(
    sp.q ||
      sp.subject ||
      sp.level ||
      sp.grade ||
      sp.docType ||
      sp.fileFormat ||
      sp.difficulty ||
      sp.university ||
      sp.course,
  );

  // Discovery vs Grid mode (pattern Studocu/CourseHero):
  //   - Discovery (mặc định /library): carousel curated + browse chips, KHÔNG
  //     đổ full grid → trang đầu gọn, dẫn dắt khám phá.
  //   - Grid: full danh sách + filter + phân trang. Bật khi search/lọc, hoặc
  //     click "See all" carousel (?sort=...) / chip trường-môn.
  const showGrid = hasActiveSearch || Boolean(sp.sort);
  const isDiscovery = !showGrid;

  // Get global stats cho hero — qua lib-fn cache-aside (Redis, TTL 3600s),
  // invalidate bằng onLibraryCatalogChanged khi doc finalize. Cắt 1 round-trip
  // DB/agg mỗi lần render trang (route động vì layout đọc session).
  const totalStats = await getLibraryHubStats();

  // Phase 4 Step 5 — hiển thị PRO upgrade banner cho user FREE
  const session = await auth.api.getSession({ headers: await headers() });
  const isPro = session ? await isUserPro(session.user.id) : false;
  const t = await getServerT();

  return (
    <PageShell size="wide">
      {/* Hero CHUNG — chip icon cũ → eyebrowIcon, dòng stats giữ làm description.
          Cụm nút action giữ NGUYÊN link/logic, đặt vào slot children bên phải. */}
      <PageHero
        eyebrow="Thư viện"
        eyebrowIcon={LibraryIcon}
        title={t('library.hub.title')}
        description={
          <>
            <span className="font-mono font-semibold tabular-nums">
              {totalStats.total}
            </span>{' '}
            {t('library.hub.stats.docs')}
            {/* Chỉ hiện "lượt thêm" khi thật sự > 0 (số liệu thật, không bịa) */}
            {totalStats.totalImports > 0 && (
              <>
                {' · '}
                <span className="font-mono font-semibold tabular-nums">
                  {totalStats.totalImports}
                </span>{' '}
                {t('library.hub.stats.imports')}
              </>
            )}
          </>
        }
      >
        {/* Button group: wrap đẹp trên mobile, no overflow.
            Label hide trên mobile cực hẹp <sm cho secondary buttons (Karma/Remix/Graph/Me)
            để tiết kiệm space — chỉ giữ icon. Upload + PRO luôn show full. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* "Khám phá" → trang directory trường/môn kiểu Studocu */}
          <Button variant="outline" size="sm" asChild>
            <Link href="/library/universities" className="gap-1" aria-label={t('library.hub.browse')}>
              <Compass className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('library.hub.browse')}</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/library/karma" className="gap-1" aria-label={t('library.hub.nav.karma')}>
              <Crown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('library.hub.nav.karma')}</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/library/remix" className="gap-1" aria-label={t('library.hub.nav.remix')}>
              <Layers className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('library.hub.nav.remix')}</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/library/me" className="gap-1" aria-label={t('library.hub.nav.me')}>
              <FileText className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('library.hub.nav.me')}</span>
            </Link>
          </Button>
          {/* Chỉ hiện "PRO active" cho subscriber — upsell PRO cho user FREE
              đã có banner dưới search (gỡ nút upsell ở header để hết trùng). */}
          {isPro && (
            <Button
              size="sm"
              asChild
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
            >
              <Link href="/library/pro" className="gap-1">
                <Crown className="h-3.5 w-3.5" />
                {t('library.hub.nav.pro_active')}
              </Link>
            </Button>
          )}
          <Button size="sm" asChild>
            <Link href="/library/upload" className="gap-1">
              <Upload className="h-3.5 w-3.5" />
              {t('library.hub.nav.upload')}
            </Link>
          </Button>
        </div>
      </PageHero>

      {/* CONTENT chức năng — search lớn + PRO strip KHÔNG nhồi vào hero, đặt
          ngay sau PageHero (giữ nguyên logic/link). */}
      <div className="mb-6 mt-6 flex flex-col gap-4">
        {/* Unified search — 3 mode (Free / Goal / Reverse) inline */}
        <UnifiedSearch />

        {/* PRO upgrade strip — chỉ hiện cho user FREE ở discovery mode */}
        {session && !isPro && isDiscovery && (
          <Link
            href="/library/pro"
            className="group/p relative overflow-hidden rounded-xl border border-discovery-500/30 bg-gradient-to-r from-discovery-600/10 via-fuchsia-600/10 to-purple-600/10 px-4 py-2.5 transition-all hover:border-discovery-500/50 hover:from-discovery-600/15 hover:via-fuchsia-600/15 hover:to-purple-600/15"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="rounded-md bg-discovery-500/20 p-1.5">
                  <Crown className="h-3.5 w-3.5 text-discovery-600" />
                </span>
                <div>
                  <p className="text-[12.5px] font-semibold">
                    {t('library.hub.pro_banner.title')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('library.hub.pro_banner.sub')}
                  </p>
                </div>
              </div>
              <span className="text-[12px] font-semibold text-discovery-600 transition-transform group-hover/p:translate-x-0.5">
                {t('library.hub.pro_banner.cta')}
              </span>
            </div>
          </Link>
        )}
      </div>

      {isDiscovery ? (
        /* ── Discovery mode (mặc định) ─────────────────────────────────
           Feed thuần carousel tài liệu (giống Studocu/CourseHero home). KHÔNG
           đổ full grid, KHÔNG hàng pill browse — browse nằm ở dropdown "Khám
           phá" trên header; full grid vào qua search/See-all/chip. */
        <>
          {/* Recently viewed (Phase 4) — chỉ show khi logged-in có view history */}
          <RecentlyViewed />

          {/* Saved searches strip (Phase 4) */}
          <SavedSearchBar />

          {/* Curated rows (Phase 4) — feed thuần carousel; browse theo
              trường/môn đã chuyển vào dropdown "Khám phá" ở header */}
          <HubCuratedSections hasActiveSearch={false} />
        </>
      ) : (
        /* ── Grid mode ── full danh sách + filter + phân trang */
        <Suspense fallback={<LibraryGridSkeleton />}>
          <LibraryGrid sp={sp} />
        </Suspense>
      )}
    </PageShell>
  );
}

/**
 * Skeleton grid — pulse placeholder cho 8 card khi Suspense fetch async.
 * Match aspect-[3/4] + spacing thật của LibraryGrid để layout không nhảy.
 */
function LibraryGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex animate-pulse flex-col gap-3 overflow-hidden rounded-2xl border border-divider bg-card p-4"
        >
          <div className="aspect-[3/4] w-full rounded-xl bg-muted" />
          <div className="h-3.5 w-4/5 rounded bg-muted" />
          <div className="h-3 w-3/5 rounded bg-muted" />
          <div className="flex gap-1">
            <div className="h-3 w-12 rounded-full bg-muted" />
            <div className="h-3 w-14 rounded-full bg-muted" />
          </div>
          <div className="mt-auto flex justify-between border-t border-divider pt-2.5">
            <div className="h-3 w-10 rounded bg-muted" />
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
