import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';

import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { getServerT } from '@/lib/i18n/server';
import { getUniversitiesDirectory } from '@/lib/library/get-universities-directory';
import { BrowseDirectory } from '@/components/library/browse-directory';

export const dynamic = 'force-dynamic';

export default async function UniversitiesDirectoryPage() {
  const t = await getServerT();
  const { unis, generalCourses } = await getUniversitiesDirectory();

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
