/**
 * /library/remix — Bonus #12 Remix builder (Phase 3, 2026-05-27).
 *
 * Page server load list user's imported docs + UI client pick 2-5 + submit
 * remix form.
 */
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { and, desc, eq } from 'drizzle-orm';

import {
  db,
  libraryDoc,
  libraryDocImport,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { getServerT } from '@/lib/i18n/server';
import { PageShell } from '@/components/layout/page-shell';
import { RemixBuilder } from '@/components/library/remix-builder';

export const dynamic = 'force-dynamic';

export default async function LibraryRemixPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect('/sign-in?callbackUrl=/library/remix');
  }
  const t = await getServerT();

  // List user's imported docs (latest 50) + own uploads
  const imports = await db
    .selectDistinctOn([libraryDoc.id], {
      id: libraryDoc.id,
      title: libraryDoc.title,
      subjectSlug: libraryDoc.subjectSlug,
      docType: libraryDoc.docType,
      pageCount: libraryDoc.pageCount,
      qualityScore: libraryDoc.qualityScore,
    })
    .from(libraryDocImport)
    .innerJoin(libraryDoc, eq(libraryDoc.id, libraryDocImport.docId))
    .where(
      and(
        eq(libraryDocImport.importerId, session.user.id),
        eq(libraryDoc.status, 'PUBLISHED'),
      ),
    )
    .orderBy(libraryDoc.id, desc(libraryDocImport.importedAt))
    .limit(50);

  const ownUploads = await db
    .select({
      id: libraryDoc.id,
      title: libraryDoc.title,
      subjectSlug: libraryDoc.subjectSlug,
      docType: libraryDoc.docType,
      pageCount: libraryDoc.pageCount,
      qualityScore: libraryDoc.qualityScore,
    })
    .from(libraryDoc)
    .where(
      and(
        eq(libraryDoc.uploaderId, session.user.id),
        eq(libraryDoc.status, 'PUBLISHED'),
      ),
    )
    .orderBy(desc(libraryDoc.createdAt))
    .limit(20);

  // Dedup by id (overlap có thể xảy ra)
  const seen = new Set<string>();
  const available = [...imports, ...ownUploads]
    .filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    })
    .map((d) => ({
      ...d,
      qualityScore: d.qualityScore ? Number(d.qualityScore) : null,
    }));

  return (
    <PageShell size="wide">
      <Link
        href="/library"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {t('library.remix.back')}
      </Link>

      <header className="mb-5 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-discovery-500/15 text-discovery-600">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t('library.remix.page_title')}</h1>
          <p className="text-[12px] text-muted-foreground">
            {t('library.remix.page_desc')}
          </p>
        </div>
      </header>

      <RemixBuilder availableDocs={available} />
    </PageShell>
  );
}
