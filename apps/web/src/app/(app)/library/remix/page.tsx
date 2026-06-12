import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Sparkles } from 'lucide-react';

import { apiServer } from '@/lib/api-server';
import { getServerSession } from '@/lib/auth-server';
import { getServerT } from '@/lib/i18n/server';
import { PageShell } from '@/components/layout/page-shell';
import { RemixBuilder } from '@/components/library/remix-builder';

export const dynamic = 'force-dynamic';

export default async function LibraryRemixPage() {
  const session = await getServerSession();
  if (!session) {
    redirect('/sign-in?callbackUrl=/library/remix');
  }
  const t = await getServerT();

  const { available } = await apiServer<{
    available: Array<{
      id: string;
      title: string;
      subjectSlug: string;
      docType: string;
      pageCount: number | null;
      qualityScore: number | null;
    }>;
  }>('/api/library/remix/available');

  return (
    <PageShell size="wide">
      <Link
        href="/library"
        className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-[12px]"
      >
        <ArrowLeft className="h-3 w-3" />
        {t('library.remix.back')}
      </Link>

      <header className="mb-5 flex items-center gap-3">
        <span className="bg-discovery-500/15 text-discovery-600 flex h-10 w-10 items-center justify-center rounded-xl">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t('library.remix.page_title')}</h1>
          <p className="text-muted-foreground text-[12px]">{t('library.remix.page_desc')}</p>
        </div>
      </header>

      <RemixBuilder availableDocs={available} />
    </PageShell>
  );
}
