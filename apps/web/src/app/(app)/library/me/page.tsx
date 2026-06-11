import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import {
  ArrowLeft,
  Crown,
  Download as DownloadIcon,
  ImportIcon,
  Layers,
  Sparkles,
  Star,
  Upload,
} from 'lucide-react';

import {
  db,
  libraryDoc,
  libraryDocEndorsement,
  libraryCreatorKarma,
  libraryKarmaEvent,
} from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/layout/empty-state';
import { SectionHeading } from '@/components/ui/section-heading';
import { StatCard } from '@/components/ui/stat-card';
import { getServerT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, { labelKey: string; class: string }> = {
  PUBLISHED: {
    labelKey: 'library.me.status.published',
    class: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  PROCESSING: {
    labelKey: 'library.me.status.processing',
    class: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  HIDDEN: {
    labelKey: 'library.me.status.hidden',
    class: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  },
};

export default async function CreatorDashboardPage() {
  const t = await getServerT();
  const session = await getServerSession();
  if (!session) {
    redirect('/sign-in?callbackUrl=/library/me');
  }
  const userId = session.user.id;

  const docs = await db
    .select({
      id: libraryDoc.id,
      title: libraryDoc.title,
      subjectSlug: libraryDoc.subjectSlug,
      docType: libraryDoc.docType,
      status: libraryDoc.status,
      pageCount: libraryDoc.pageCount,
      viewCount: libraryDoc.viewCount,
      downloadCount: libraryDoc.downloadCount,
      workspaceImportCount: libraryDoc.workspaceImportCount,
      remixCount: libraryDoc.remixCount,
      ratingAvg: libraryDoc.ratingAvg,
      ratingCount: libraryDoc.ratingCount,
      qualityScore: libraryDoc.qualityScore,
      badges: libraryDoc.badges,
      createdAt: libraryDoc.createdAt,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.uploaderId, userId))
    .orderBy(desc(libraryDoc.createdAt));

  const [karma] = await db
    .select({
      points: libraryCreatorKarma.points,
      lastEventAt: libraryCreatorKarma.lastEventAt,
    })
    .from(libraryCreatorKarma)
    .where(eq(libraryCreatorKarma.userId, userId))
    .limit(1);

  let rank: number | null = null;
  if (karma?.points) {
    const [r] = await db
      .select({ n: sql<number>`COUNT(*)::int + 1` })
      .from(libraryCreatorKarma)
      .where(sql`${libraryCreatorKarma.points} > ${karma.points}`);
    rank = Number(r?.n ?? 1);
  }

  const [agg] = await db
    .select({
      totalImports: sql<number>`COALESCE(SUM(${libraryDoc.workspaceImportCount}), 0)::int`,
      totalDownloads: sql<number>`COALESCE(SUM(${libraryDoc.downloadCount}), 0)::int`,
      totalRemixes: sql<number>`COALESCE(SUM(${libraryDoc.remixCount}), 0)::int`,
      totalDocs: sql<number>`COUNT(*)::int`,
      avgQuality: sql<number>`COALESCE(AVG(${libraryDoc.qualityScore}), 0)::float`,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.uploaderId, userId));

  const [endorseAgg] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(libraryDocEndorsement)
    .innerJoin(libraryDoc, eq(libraryDoc.id, libraryDocEndorsement.docId))
    .where(eq(libraryDoc.uploaderId, userId));

  const recentEvents = await db
    .select({
      id: libraryKarmaEvent.id,
      eventType: libraryKarmaEvent.eventType,
      points: libraryKarmaEvent.points,
      docId: libraryKarmaEvent.docId,
      createdAt: libraryKarmaEvent.createdAt,
      docTitle: libraryDoc.title,
    })
    .from(libraryKarmaEvent)
    .leftJoin(libraryDoc, eq(libraryDoc.id, libraryKarmaEvent.docId))
    .where(eq(libraryKarmaEvent.userId, userId))
    .orderBy(desc(libraryKarmaEvent.createdAt))
    .limit(10);

  return (
    <PageShell size="wide">
      <Link
        href="/library"
        className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-[12px]"
      >
        <ArrowLeft className="h-3 w-3" />
        {t('library.back')}
      </Link>

      <PageHero
        eyebrow="Creator"
        eyebrowIcon={Sparkles}
        title={t('library.me.title')}
        description={t('library.me.subtitle')}
        className="mb-5"
      >
        <Button asChild>
          <Link href="/library/upload" className="gap-1">
            <Upload className="h-3.5 w-3.5" />
            {t('library.me.upload_new')}
          </Link>
        </Button>
      </PageHero>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="to-card rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
            <Crown className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Karma</span>
          </div>
          <p className="text-2xl font-bold tabular-nums">
            {(karma?.points ?? 0).toLocaleString('vi-VN')}
          </p>
          {rank && (
            <p className="text-muted-foreground text-[11px]">
              {t('library.me.rank').replace('{rank}', String(rank))}
            </p>
          )}
        </div>
        <StatCard
          icon={ImportIcon}
          tint="bg-sky-500/10"
          tintText="text-sky-600 dark:text-sky-400"
          label={t('library.me.stat.import')}
          value={(agg?.totalImports ?? 0).toLocaleString('vi-VN')}
        />
        <StatCard
          icon={DownloadIcon}
          tint="bg-emerald-500/10"
          tintText="text-emerald-600 dark:text-emerald-400"
          label={t('library.me.stat.download')}
          value={(agg?.totalDownloads ?? 0).toLocaleString('vi-VN')}
        />
        <StatCard
          icon={Layers}
          tint="bg-discovery-500/10"
          tintText="text-discovery-600 dark:text-discovery-400"
          label={t('library.me.stat.remix')}
          value={(agg?.totalRemixes ?? 0).toLocaleString('vi-VN')}
        />
        <StatCard
          icon={Star}
          tint="bg-amber-500/10"
          tintText="text-amber-600 dark:text-amber-400"
          label={t('library.me.stat.endorse')}
          value={(endorseAgg?.total ?? 0).toLocaleString('vi-VN')}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <SectionHeading count={docs.length}>{t('library.me.docs')}</SectionHeading>

          {docs.length === 0 ? (
            <EmptyState
              variant="card"
              icon={Upload}
              title={t('library.me.empty_prefix')}
              action={
                <Button size="sm" asChild>
                  <Link href="/library/upload" className="gap-1.5">
                    <Upload className="h-3.5 w-3.5" />
                    {t('library.me.empty_cta')}
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {docs.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/library/${d.id}`}
                    className="border-divider bg-card hover:border-primary/30 group flex flex-col gap-2 rounded-xl border p-3 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-1 text-[13px] font-semibold">{d.title}</p>
                      <Badge
                        variant="outline"
                        className={`h-5 shrink-0 border-transparent px-1.5 text-[10px] ${
                          STATUS_LABEL[d.status]?.class ?? ''
                        }`}
                      >
                        {STATUS_LABEL[d.status] ? t(STATUS_LABEL[d.status]!.labelKey) : d.status}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-3 text-[11px]">
                      <span className="inline-flex items-center gap-0.5">
                        <ImportIcon className="h-2.5 w-2.5" />
                        {d.workspaceImportCount}
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <DownloadIcon className="h-2.5 w-2.5" />
                        {d.downloadCount}
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <Layers className="h-2.5 w-2.5" />
                        {d.remixCount} {t('library.me.remix_suffix')}
                      </span>
                      {d.ratingAvg && (
                        <span className="inline-flex items-center gap-0.5">
                          <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
                          {Number(d.ratingAvg).toFixed(1)} ({d.ratingCount})
                        </span>
                      )}
                      {d.qualityScore && Number(d.qualityScore) > 0 && (
                        <span className="bg-discovery-500/15 text-discovery-700 dark:text-discovery-300 ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                          Q{Number(d.qualityScore).toFixed(0)}
                        </span>
                      )}
                    </div>
                    {d.badges && d.badges.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {d.badges.map((b) => (
                          <span
                            key={b}
                            className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
                          >
                            {b.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside>
          <SectionHeading>{t('library.me.karma_earn')}</SectionHeading>
          {recentEvents.length === 0 ? (
            <p className="border-divider bg-card text-muted-foreground rounded-xl border p-4 text-center text-[12px]">
              {t('library.me.no_karma')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recentEvents.map((e) => {
                const EVENT_KEY: Record<string, string> = {
                  doc_imported: 'library.me.event.doc_imported',
                  doc_remixed: 'library.me.event.doc_remixed',
                  endorsed: 'library.me.event.endorsed',
                  high_quality: 'library.me.event.high_quality',
                };
                return (
                  <li key={e.id} className="border-divider bg-card rounded-lg border p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11.5px]">
                          {EVENT_KEY[e.eventType] ? t(EVENT_KEY[e.eventType]!) : e.eventType}
                        </p>
                        {e.docId && e.docTitle && (
                          <Link
                            href={`/library/${e.docId}`}
                            className="text-muted-foreground hover:text-foreground line-clamp-1 text-[11px]"
                          >
                            → {e.docTitle}
                          </Link>
                        )}
                        <p className="text-muted-foreground/70 mt-0.5 text-[11px]">
                          {new Date(e.createdAt).toLocaleString('vi-VN')}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                        +{e.points}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <Link
            href="/library/karma"
            className="text-primary mt-3 inline-block text-[11.5px] font-semibold hover:underline"
          >
            {t('library.me.view_leaderboard')}
          </Link>
        </aside>
      </div>

      {agg && agg.totalDocs > 0 && (
        <p className="text-muted-foreground mt-6 text-center text-[11px]">
          {t('library.me.avg_quality_prefix')} <strong>{agg.avgQuality.toFixed(1)}/100</strong>{' '}
          {t('library.me.avg_quality_suffix').replace('{count}', String(agg.totalDocs))}
        </p>
      )}
    </PageShell>
  );
}
