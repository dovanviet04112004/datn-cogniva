import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';

import { PageShell } from '@/components/layout/page-shell';
import { apiServer } from '@/lib/api-server';
import { getServerT } from '@/lib/i18n/server';
import { BrowseDirectory } from '@/components/library/browse-directory';

export const dynamic = 'force-dynamic';

type UniversitiesDirectory = {
  unis: Array<{
    id: string;
    name: string;
    shortName: string | null;
    docCount: number;
    courseCount: number;
  }>;
  generalCourses: Array<{ id: string; name: string; code: string | null; docCount: number }>;
};

export default async function UniversitiesDirectoryPage() {
  const t = await getServerT();
  const { unis, generalCourses } = await apiServer<UniversitiesDirectory>(
    '/api/library/browse/universities',
  );

  return (
    <PageShell size="wide">
      <div className="mb-3">
        <Link
          href="/library"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[12px]"
        >
          <ArrowLeft className="h-3 w-3" />
          {t('library.hub.title')}
        </Link>
      </div>

      <header className="border-divider mb-6 flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="bg-primary/10 text-primary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            <Compass className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight tracking-tight sm:text-xl">
              {t('library.browse.title')}
            </h1>
            <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[13px] leading-snug">
              {t('library.browse.subtitle')}
            </p>
          </div>
        </div>
      </header>

      <BrowseDirectory universities={unis} generalCourses={generalCourses} />
    </PageShell>
  );
}
