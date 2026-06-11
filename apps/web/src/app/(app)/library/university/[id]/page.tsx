import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Building2, Compass, Upload } from 'lucide-react';

import { PageShell } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { UniversityCourseBrowser } from '@/components/library/university-course-browser';
import { getUniversityDetail } from '@/lib/library/get-catalog-detail';
import { getServerT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export default async function UniversityPage({ params }: Params) {
  const { id } = await params;
  const t = await getServerT();

  const detail = await getUniversityDetail(id);
  if (!detail) return notFound();
  const { uni, courses, docTypeBreakdown } = detail;

  return (
    <PageShell size="wide">
      <div className="text-muted-foreground mb-3 flex items-center gap-1.5 text-[12px]">
        <Link href="/library" className="hover:text-foreground">
          {t('library.hub.title')}
        </Link>
        <span className="opacity-40">/</span>
        <Link
          href="/library/universities"
          className="hover:text-foreground inline-flex items-center gap-1"
        >
          <Compass className="h-3 w-3" />
          {t('library.browse.title')}
        </Link>
        <span className="opacity-40">/</span>
        <span className="text-foreground/80 truncate font-medium">{uni.shortName ?? uni.name}</span>
      </div>

      <header className="border-divider from-sky-500/8 via-card to-card mb-6 flex flex-col gap-3 rounded-2xl border bg-gradient-to-br p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
            <Building2 className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{uni.name}</h1>
            <p className="text-muted-foreground mt-0.5 text-[12.5px]">
              {uni.shortName && <span className="font-semibold">{uni.shortName} · </span>}
              <span className="font-mono font-semibold tabular-nums">{uni.docCount}</span>{' '}
              {t('library.hub.stats.docs')} · {courses.length} {t('library.university.courses')}
            </p>
          </div>
        </div>
        <Button asChild variant="outline" className="shrink-0">
          <Link href="/library/upload" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            {t('library.hub.nav.upload')}
          </Link>
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          <h2 className="text-muted-foreground mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
            <BookOpen className="h-3.5 w-3.5" />
            {t('library.university.courses')}
            <span className="text-muted-foreground/60 font-mono tabular-nums">
              {courses.length}
            </span>
          </h2>
          {courses.length > 0 ? (
            <UniversityCourseBrowser courses={courses} />
          ) : (
            <p className="border-divider text-muted-foreground rounded-xl border border-dashed py-10 text-center text-[13px]">
              {t('library.university.no_course_match')}
            </p>
          )}
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="border-divider bg-card rounded-2xl border p-4">
            <h3 className="text-muted-foreground mb-3 text-[11px] font-semibold uppercase tracking-wider">
              {t('library.university.content_categories')}
            </h3>
            <dl className="space-y-2.5">
              <div className="border-divider flex items-baseline justify-between border-b pb-2.5">
                <dt className="text-[12.5px] font-medium">
                  {t('library.university.total_documents')}
                </dt>
                <dd className="text-discovery-600 font-mono text-[15px] font-bold tabular-nums">
                  {uni.docCount}
                </dd>
              </div>
              {docTypeBreakdown.map((r) => (
                <div key={r.docType} className="flex items-baseline justify-between">
                  <dt className="text-muted-foreground text-[12.5px]">
                    {t(`library.doctype.${r.docType}`)}
                  </dt>
                  <dd className="text-foreground/80 font-mono text-[12.5px] tabular-nums">
                    {Number(r.n)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
