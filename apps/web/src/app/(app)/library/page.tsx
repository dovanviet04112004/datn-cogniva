import { Suspense } from 'react';
import { Compass, Crown, FileText, Library as LibraryIcon, Layers, Upload } from 'lucide-react';

import { apiServer } from '@/lib/api-server';
import { getServerSession } from '@/lib/auth-server';
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

  const showGrid = hasActiveSearch || Boolean(sp.sort);
  const isDiscovery = !showGrid;

  const totalStats = await apiServer<{ total: number; totalImports: number }>(
    '/api/library/stats/hub',
  );

  const session = await getServerSession();
  const proStatus = session
    ? await apiServer<{ plan: string | null; proUntilAt: string | null }>('/api/library/pro-status')
    : null;
  const isPro =
    !!proStatus &&
    proStatus.plan === 'PRO' &&
    (!proStatus.proUntilAt || new Date(proStatus.proUntilAt) > new Date());
  const t = await getServerT();

  return (
    <PageShell size="wide">
      <PageHero
        eyebrow="Thư viện"
        eyebrowIcon={LibraryIcon}
        title={t('library.hub.title')}
        description={
          <>
            <span className="font-mono font-semibold tabular-nums">{totalStats.total}</span>{' '}
            {t('library.hub.stats.docs')}
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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link
              href="/library/universities"
              className="gap-1"
              aria-label={t('library.hub.browse')}
            >
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

      <div className="mb-6 mt-6 flex flex-col gap-4">
        <UnifiedSearch />

        {session && !isPro && isDiscovery && (
          <Link
            href="/library/pro"
            className="group/p border-discovery-500/30 from-discovery-600/10 hover:border-discovery-500/50 hover:from-discovery-600/15 relative overflow-hidden rounded-xl border bg-gradient-to-r via-fuchsia-600/10 to-purple-600/10 px-4 py-2.5 transition-all hover:via-fuchsia-600/15 hover:to-purple-600/15"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="bg-discovery-500/20 rounded-md p-1.5">
                  <Crown className="text-discovery-600 h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-[12.5px] font-semibold">{t('library.hub.pro_banner.title')}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {t('library.hub.pro_banner.sub')}
                  </p>
                </div>
              </div>
              <span className="text-discovery-600 text-[12px] font-semibold transition-transform group-hover/p:translate-x-0.5">
                {t('library.hub.pro_banner.cta')}
              </span>
            </div>
          </Link>
        )}
      </div>

      {isDiscovery ? (
        <>
          <RecentlyViewed />

          <SavedSearchBar />

          <HubCuratedSections hasActiveSearch={false} />
        </>
      ) : (
        <Suspense fallback={<LibraryGridSkeleton />}>
          <LibraryGrid sp={sp} />
        </Suspense>
      )}
    </PageShell>
  );
}

function LibraryGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="border-divider bg-card flex animate-pulse flex-col gap-3 overflow-hidden rounded-2xl border p-4"
        >
          <div className="bg-muted aspect-[3/4] w-full rounded-xl" />
          <div className="bg-muted h-3.5 w-4/5 rounded" />
          <div className="bg-muted h-3 w-3/5 rounded" />
          <div className="flex gap-1">
            <div className="bg-muted h-3 w-12 rounded-full" />
            <div className="bg-muted h-3 w-14 rounded-full" />
          </div>
          <div className="border-divider mt-auto flex justify-between border-t pt-2.5">
            <div className="bg-muted h-3 w-10 rounded" />
            <div className="bg-muted h-3 w-16 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
