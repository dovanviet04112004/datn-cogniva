import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';

import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
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

      <PageHero
        eyebrow="Khám phá"
        eyebrowIcon={Compass}
        title={t('library.browse.title')}
        description={t('library.browse.subtitle')}
        className="mb-6"
      />

      <BrowseDirectory universities={unis} generalCourses={generalCourses} />
    </PageShell>
  );
}
