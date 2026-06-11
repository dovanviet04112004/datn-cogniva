import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BookOpen, FileText, Upload } from 'lucide-react';

import { PageShell } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { LibraryGrid } from '@/components/library/library-grid';
import { getCourseDetail } from '@/lib/library/get-catalog-detail';
import { getServerT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };
type SP = {
  level?: string;
  grade?: string;
  docType?: string;
  fileFormat?: string;
  difficulty?: string;
  sort?: string;
  page?: string;
  per?: string;
};

export default async function CoursePage({
  params,
  searchParams,
}: Params & { searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await getServerT();

  const course = await getCourseDetail(id);
  if (!course) return notFound();

  return (
    <PageShell size="wide">
      <div className="text-muted-foreground mb-3 flex flex-wrap items-center gap-1 text-[12px]">
        <Link href="/library" className="hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" />
          {t('library.hub.title')}
        </Link>
        {course.universityId && course.universityName && (
          <>
            <span className="opacity-50">›</span>
            <Link
              href={`/library/university/${course.universityId}`}
              className="hover:text-foreground"
            >
              🏛 {course.universityShort ?? course.universityName}
            </Link>
          </>
        )}
      </div>

      <header className="border-discovery-500/20 from-discovery-500/8 via-card to-card mb-6 flex flex-col gap-3 rounded-2xl border bg-gradient-to-br p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className="bg-discovery-500/15 text-discovery-600 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl">
            <BookOpen className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">
              {course.code ? (
                <>
                  <span className="text-discovery-600">{course.code}</span> {course.name}
                </>
              ) : (
                course.name
              )}
            </h1>
            <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[12.5px]">
              <FileText className="h-3.5 w-3.5" />
              <span className="font-mono font-semibold tabular-nums">{course.docCount}</span>{' '}
              {t('library.hub.stats.docs')}
              {!course.universityId && (
                <>
                  <span className="opacity-50">·</span>
                  <span>{t('library.picker.general')}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <Button asChild className="shrink-0">
          <Link href={`/library/upload?course=${course.id}`} className="gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            {t('library.course.contribute')}
          </Link>
        </Button>
      </header>

      <LibraryGrid sp={{ ...sp, course: id }} />
    </PageShell>
  );
}
