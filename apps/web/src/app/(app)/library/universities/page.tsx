/**
 * /library/universities — Directory "Khám phá" kiểu Studocu (2026-05-28).
 *
 * Đích của nút "Khám phá" ở header (thay dropdown cũ). Liệt kê trường dạng card
 * + môn chung, có search lọc real-time. Click trường → trang trường giàu.
 */
import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';

import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { getServerT } from '@/lib/i18n/server';
import { getUniversitiesDirectory } from '@/lib/library/get-universities-directory';
import { BrowseDirectory } from '@/components/library/browse-directory';

// Route bị (app)/layout ép dynamic; data công khai cache ở tầng DATA qua
// unstable_cache trong getUniversitiesDirectory (revalidate 1h).
export const dynamic = 'force-dynamic';

export default async function UniversitiesDirectoryPage() {
  const t = await getServerT();
  const { unis, generalCourses } = await getUniversitiesDirectory();

  return (
    <PageShell size="wide">
      <div className="mb-3">
        <Link
          href="/library"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          {t('library.hub.title')}
        </Link>
      </div>

      {/* Hero CHUNG — chip Compass cũ → eyebrowIcon, title/subtitle giữ nguyên.
          BrowseDirectory (gồm search lọc real-time) là CONTENT, đặt ngay sau hero. */}
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
