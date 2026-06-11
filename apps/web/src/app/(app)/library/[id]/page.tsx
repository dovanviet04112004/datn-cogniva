import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, eq, inArray } from 'drizzle-orm';
import {
  ArrowLeft,
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Globe,
  Hash,
  Layers,
  Scale,
  Sparkles,
  Star,
} from 'lucide-react';

import { randomUUID } from 'node:crypto';

import { db, libraryDoc, libraryDocView, libraryUniversity, user as userTable } from '@cogniva/db';
import { LEVEL_NAMES, SUBJECT_BY_SLUG } from '@cogniva/db/taxonomy';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/layout/page-shell';

import { AnnotationsSection } from '@/components/library/annotations-section';
import { DocAtomMap } from '@/components/library/doc-atom-map';
import { DocPreviewPanel } from '@/components/library/doc-preview-panel';
import { DocReviewSection } from '@/components/library/doc-review-section';
import { DuplicateWarning } from '@/components/library/duplicate-warning';
import { EndorseSection } from '@/components/library/endorse-section';
import { ImportToWorkspaceButton } from '@/components/library/import-to-workspace-button';
import { PodcastPlayer } from '@/components/library/podcast-player';
import { PremiumLockedPreview } from '@/components/library/premium-purchase-button';
import { PrereqWarning } from '@/components/library/prereq-warning';
import { RelatedDocsSection } from '@/components/library/related-docs-section';
import { TranslatableText } from '@/components/library/translate-button';
import { getServerSession } from '@/lib/auth-server';
import { checkDocAccess } from '@/lib/library/access';
import { getServerT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

const DOC_TYPE_KEY: Record<string, string> = {
  lecture_notes: 'library.doctype.lecture_notes',
  summary: 'library.doctype.summary',
  exam: 'library.doctype.exam',
  exercise: 'library.doctype.exercise',
  solution: 'library.doctype.solution',
  reference_book: 'library.doctype.reference_book',
  thesis: 'library.doctype.thesis',
  handout: 'library.doctype.handout',
  mind_map: 'library.doctype.mind_map',
  other: 'library.doctype.other',
};

type Params = { params: Promise<{ id: string }> };

export default async function LibraryDetailPage({ params }: Params) {
  const { id } = await params;

  const [doc] = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      uploaderName: userTable.name,
      uploaderImage: userTable.image,
      title: libraryDoc.title,
      description: libraryDoc.description,
      subjectSlug: libraryDoc.subjectSlug,
      level: libraryDoc.level,
      grade: libraryDoc.grade,
      docType: libraryDoc.docType,
      examType: libraryDoc.examType,
      schoolYear: libraryDoc.schoolYear,
      region: libraryDoc.region,
      language: libraryDoc.language,
      tags: libraryDoc.tags,
      fileFormat: libraryDoc.fileFormat,
      fileSizeBytes: libraryDoc.fileSizeBytes,
      pageCount: libraryDoc.pageCount,
      previewThumbUrl: libraryDoc.previewThumbUrl,
      aiSummary: libraryDoc.aiSummary,
      previewText: libraryDoc.previewText,
      license: libraryDoc.license,
      status: libraryDoc.status,
      ratingAvg: libraryDoc.ratingAvg,
      ratingCount: libraryDoc.ratingCount,
      viewCount: libraryDoc.viewCount,
      downloadCount: libraryDoc.downloadCount,
      workspaceImportCount: libraryDoc.workspaceImportCount,
      qualityScore: libraryDoc.qualityScore,
      badges: libraryDoc.badges,
      parentRemixDocIds: libraryDoc.parentRemixDocIds,
      remixCount: libraryDoc.remixCount,
      isPremium: libraryDoc.isPremium,
      priceVnd: libraryDoc.priceVnd,
      creatorSharePct: libraryDoc.creatorSharePct,
      courseId: libraryDoc.courseId,
      courseNameCache: libraryDoc.courseNameCache,
      universityId: libraryDoc.universityId,
      createdAt: libraryDoc.createdAt,
    })
    .from(libraryDoc)
    .leftJoin(userTable, eq(userTable.id, libraryDoc.uploaderId))
    .where(eq(libraryDoc.id, id))
    .limit(1);

  if (!doc) return notFound();

  let parentRemixDocs: Array<{ id: string; title: string; uploaderName: string | null }> = [];
  if (doc.parentRemixDocIds && doc.parentRemixDocIds.length > 0) {
    parentRemixDocs = await db
      .select({
        id: libraryDoc.id,
        title: libraryDoc.title,
        uploaderName: userTable.name,
      })
      .from(libraryDoc)
      .leftJoin(userTable, eq(userTable.id, libraryDoc.uploaderId))
      .where(
        and(inArray(libraryDoc.id, doc.parentRemixDocIds), eq(libraryDoc.status, 'PUBLISHED')),
      );
  }

  const t = await getServerT();
  const subj = SUBJECT_BY_SLUG[doc.subjectSlug];
  const isProcessing = doc.status === 'PROCESSING';
  const isHidden = doc.status === 'HIDDEN';

  let universityName: string | null = null;
  if (doc.universityId) {
    const [u] = await db
      .select({ name: libraryUniversity.name, shortName: libraryUniversity.shortName })
      .from(libraryUniversity)
      .where(eq(libraryUniversity.id, doc.universityId))
      .limit(1);
    universityName = u?.shortName || u?.name || null;
  }

  const session = await getServerSession();
  const viewerId = session?.user.id ?? null;
  const accessInfo = await checkDocAccess(doc.id, viewerId);
  const isPremiumLocked =
    !!doc.isPremium &&
    !!doc.priceVnd &&
    doc.priceVnd > 0 &&
    !!accessInfo &&
    !accessInfo.access.allowed;

  if (viewerId && doc.status === 'PUBLISHED') {
    void db
      .insert(libraryDocView)
      .values({
        id: randomUUID(),
        userId: viewerId,
        docId: doc.id,
        viewedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [libraryDocView.userId, libraryDocView.docId],
        set: { viewedAt: new Date() },
      })
      .catch(() => {});
  }

  return (
    <PageShell size="wide">
      <Link
        href="/library"
        className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-[12px]"
      >
        <ArrowLeft className="h-3 w-3" />
        {t('library.back')}
      </Link>

      {isHidden && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-[13px] text-rose-700 dark:text-rose-300">
          {t('library.detail.hidden')}
        </div>
      )}

      {isProcessing && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[13px] text-amber-700 dark:text-amber-300">
          <Clock className="h-4 w-4 animate-pulse" />
          {t('library.detail.processing')}
        </div>
      )}

      <DuplicateWarning docId={doc.id} />

      {parentRemixDocs.length > 0 && (
        <div className="border-discovery-500/30 bg-discovery-500/5 mb-4 flex items-start gap-2 rounded-xl border p-3">
          <Layers className="text-discovery-600 mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-[12.5px]">
            <p className="text-discovery-700 dark:text-discovery-300 font-semibold">
              {t('library.detail.remix_from')} {parentRemixDocs.length}{' '}
              {t('library.detail.remix_sources')}
            </p>
            <ul className="mt-1 space-y-0.5">
              {parentRemixDocs.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/library/${p.id}`}
                    className="text-discovery-700 dark:text-discovery-300 text-[11.5px] underline-offset-2 hover:underline"
                  >
                    → {p.title}
                  </Link>
                  {p.uploaderName && (
                    <span className="text-muted-foreground text-[11px]"> · {p.uploaderName}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {doc.remixCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-[12px]">
          <Sparkles className="h-3.5 w-3.5 text-sky-600" />
          <span>
            {t('library.detail.remixed_prefix')} <strong>{doc.remixCount}</strong>{' '}
            {t('library.detail.remixed_suffix')}
            {doc.remixCount * 5} {t('library.detail.remixed_karma')}
          </span>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px] [&>*]:min-w-0">
        <div className="order-2 lg:order-1">
          {isPremiumLocked ? (
            <PremiumLockedPreview
              docId={doc.id}
              priceVnd={doc.priceVnd!}
              creatorSharePct={doc.creatorSharePct}
              thumbUrl={doc.previewThumbUrl}
              title={doc.title}
            />
          ) : (
            <DocPreviewPanel
              docId={doc.id}
              fileFormat={doc.fileFormat}
              thumbUrl={doc.previewThumbUrl}
              title={doc.title}
              fullAccess={
                !!accessInfo &&
                accessInfo.access.allowed &&
                ['owner', 'pro', 'purchased'].includes(accessInfo.access.reason)
              }
            />
          )}
        </div>

        <aside className="order-1 flex flex-col gap-3 lg:order-2">
          <section className="flex min-w-0 flex-col gap-2.5">
            {(universityName || doc.courseNameCache) && (
              <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-[11px]">
                {universityName && doc.universityId && (
                  <>
                    <Link
                      href={`/library/university/${doc.universityId}`}
                      className="text-foreground/70 hover:text-foreground font-medium hover:underline"
                    >
                      🏛 {universityName}
                    </Link>
                    {doc.courseNameCache && <span className="opacity-50">›</span>}
                  </>
                )}
                {doc.courseNameCache && doc.courseId && (
                  <Link
                    href={`/library/course/${doc.courseId}`}
                    className="bg-discovery-500/10 text-discovery-700 hover:bg-discovery-500/20 dark:text-discovery-300 rounded-md px-1.5 py-0.5 font-medium"
                  >
                    🎓 {doc.courseNameCache}
                  </Link>
                )}
              </div>
            )}
            <h1 className="break-words text-[19px] font-bold leading-tight tracking-tight">
              {doc.title}
            </h1>
            {doc.uploaderName && (
              <div className="text-muted-foreground flex items-center gap-2 text-[11.5px]">
                <Avatar className="h-5 w-5">
                  <AvatarImage src={doc.uploaderImage ?? undefined} />
                  <AvatarFallback className="text-[9px]">
                    {doc.uploaderName[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-foreground/85 font-medium">{doc.uploaderName}</span>
                <span>·</span>
                <span>{new Date(doc.createdAt).toLocaleDateString('vi-VN')}</span>
              </div>
            )}
            {doc.badges && doc.badges.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {doc.badges.includes('outcome_verified') && (
                  <Badge className="h-5 gap-0.5 bg-amber-500/15 px-1.5 text-[10px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
                    <Award className="h-2.5 w-2.5" />
                    {t('library.badge.outcome_verified')}
                  </Badge>
                )}
                {doc.badges.includes('educator_approved') && (
                  <Badge className="h-5 gap-0.5 bg-emerald-500/15 px-1.5 text-[10px] text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {t('library.badge.educator_approved')}
                  </Badge>
                )}
                {doc.badges.includes('syllabus_complete') && (
                  <Badge className="bg-discovery-500/15 text-discovery-700 hover:bg-discovery-500/20 dark:text-discovery-300 h-5 px-1.5 text-[10px]">
                    🎯 {t('library.badge.syllabus_complete')}
                  </Badge>
                )}
                {doc.badges.includes('power_resource') && (
                  <Badge className="h-5 bg-sky-500/15 px-1.5 text-[10px] text-sky-700 hover:bg-sky-500/20 dark:text-sky-300">
                    ⚡ {t('library.badge.power_resource')}
                  </Badge>
                )}
              </div>
            )}
          </section>

          <div className="flex flex-col gap-2">
            {isPremiumLocked && (
              <p className="border-discovery-500/30 bg-discovery-500/5 text-discovery-700 dark:text-discovery-300 rounded-md border px-2 py-1.5 text-center text-[11px]">
                {t('library.detail.premium_locked').replace(
                  '{price}',
                  doc.priceVnd?.toLocaleString('vi-VN') ?? '',
                )}
              </p>
            )}
            <ImportToWorkspaceButton
              docId={doc.id}
              disabled={isProcessing || isHidden || isPremiumLocked}
            />
            <a
              href={`/api/library/docs/${doc.id}/download`}
              className="border-divider bg-card hover:bg-muted inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              {t('library.detail.download')}
            </a>
            <PodcastPlayer docId={doc.id} />
          </div>

          <section className="border-divider from-card to-muted/20 rounded-xl border bg-gradient-to-br p-3">
            {doc.qualityScore != null && Number(doc.qualityScore) > 0 && (
              <div className="border-divider/60 mb-2.5 border-b pb-2.5">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                    {t('library.detail.quality_score')}
                  </span>
                  <span className="font-mono text-[15px] font-bold tabular-nums">
                    {Number(doc.qualityScore).toFixed(1)}
                    <span className="text-muted-foreground text-[10px] font-normal">/100</span>
                  </span>
                </div>
                <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                  <div
                    className="from-discovery-500 h-full bg-gradient-to-r to-sky-500 transition-all"
                    style={{ width: `${Math.min(100, Number(doc.qualityScore))}%` }}
                  />
                </div>
              </div>
            )}
            {doc.ratingCount === 0 && doc.workspaceImportCount === 0 && doc.downloadCount === 0 ? (
              <p className="text-muted-foreground flex items-center justify-center gap-1.5 py-1 text-[11.5px]">
                <Sparkles className="text-discovery-500 h-3 w-3" />
                {t('library.detail.no_engagement')}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <StatCell
                  value={doc.ratingAvg ? Number(doc.ratingAvg).toFixed(1) : '–'}
                  label={`${doc.ratingCount} ${t('library.detail.reviews')}`}
                  icon={<Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />}
                />
                <StatCell
                  value={String(doc.workspaceImportCount)}
                  label={t('library.detail.import')}
                />
                <StatCell value={String(doc.downloadCount)} label={t('library.detail.download')} />
              </div>
            )}
          </section>

          <PrereqWarning docId={doc.id} />

          <CollapsibleSection label={t('library.detail.atom_map')}>
            <DocAtomMap docId={doc.id} pageCount={doc.pageCount} />
          </CollapsibleSection>

          <CollapsibleSection label={t('library.detail.educator_confirm')}>
            <EndorseSection docId={doc.id} />
          </CollapsibleSection>

          {doc.aiSummary && (
            <section className="border-discovery-500/20 bg-discovery-500/5 rounded-xl border p-3">
              <p className="text-discovery-600 mb-1 text-[11px] font-semibold uppercase tracking-wider">
                {t('library.detail.ai_summary')}
              </p>
              <TranslatableText
                docId={doc.id}
                text={doc.aiSummary}
                sourceLang={doc.language ?? 'vi'}
              />
            </section>
          )}

          <CollapsibleSection label={t('library.detail.detail_info')}>
            <section className="border-divider bg-card rounded-xl border p-3">
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <MetaCell
                  icon={<BookOpen className="h-3 w-3" />}
                  label={`${subj?.emoji ?? ''} ${subj?.name ?? doc.subjectSlug}`}
                />
                <MetaCell
                  icon={<Layers className="h-3 w-3" />}
                  label={
                    doc.grade
                      ? t('library.detail.grade').replace('{grade}', String(doc.grade))
                      : (LEVEL_NAMES[doc.level as keyof typeof LEVEL_NAMES] ?? doc.level)
                  }
                />
                <MetaCell
                  icon={<FileText className="h-3 w-3" />}
                  label={`${doc.fileFormat.toUpperCase()} · ${doc.pageCount ?? '–'} ${t('library.card.pages')}`}
                />
                <MetaCell
                  icon={<Globe className="h-3 w-3" />}
                  label={
                    doc.language === 'vi'
                      ? t('library.detail.lang_vi')
                      : t('library.detail.lang_en')
                  }
                />
                <MetaCell
                  icon={<Hash className="h-3 w-3" />}
                  label={DOC_TYPE_KEY[doc.docType] ? t(DOC_TYPE_KEY[doc.docType]!) : doc.docType}
                />
                {doc.license && (
                  <MetaCell icon={<Scale className="h-3 w-3" />} label={doc.license} />
                )}
              </div>
              {doc.tags && doc.tags.length > 0 && (
                <div className="border-divider/60 mt-2.5 flex flex-wrap gap-1 border-t pt-2.5">
                  {doc.tags.map((t) => (
                    <span
                      key={t}
                      className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px]"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
              {doc.description && (
                <div className="border-divider/60 mt-2.5 border-t pt-2.5">
                  <TranslatableText
                    docId={doc.id}
                    text={doc.description}
                    sourceLang={doc.language ?? 'vi'}
                    className="text-foreground/75 text-[12px]"
                  />
                </div>
              )}
            </section>
          </CollapsibleSection>
        </aside>
      </div>

      <RelatedDocsSection sourceDocId={doc.id} sourceTitle={doc.title} />

      <AnnotationsSection docId={doc.id} />

      <DocReviewSection docId={doc.id} />

      <div
        className="border-divider bg-card/95 fixed inset-x-0 bottom-0 z-50 border-t px-3 pt-2 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur-md lg:hidden"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto flex max-w-md items-center gap-2">
          {isPremiumLocked ? (
            <div className="bg-discovery-500/10 flex flex-1 items-center justify-between gap-2 rounded-lg px-3 py-1.5">
              <span className="text-discovery-700 dark:text-discovery-300 text-[11px] font-semibold">
                🔒 {doc.priceVnd?.toLocaleString('vi-VN')}đ
              </span>
              <Button asChild size="sm" className="bg-discovery-600 hover:bg-discovery-700">
                <Link href={`/library/${doc.id}#preview`}>{t('library.detail.buy_now')}</Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-2">
              <ImportToWorkspaceButton docId={doc.id} disabled={isProcessing || isHidden} />
              <a
                href={`/api/library/docs/${doc.id}/download`}
                className="border-divider bg-card inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-md border px-3 text-[12px] font-medium"
                aria-label={t('library.detail.download')}
              >
                <Download className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="h-24 lg:hidden" aria-hidden />
    </PageShell>
  );
}

function StatCell({
  value,
  label,
  icon,
}: {
  value: string;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[15px] font-bold tabular-nums leading-tight">{value}</p>
      <p className="text-muted-foreground mt-0.5 flex items-center justify-center gap-0.5 text-[11px]">
        {icon}
        {label}
      </p>
    </div>
  );
}

function MetaCell({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="text-foreground/85 flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate font-medium">{label}</span>
    </div>
  );
}

function CollapsibleSection({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="border-divider bg-card/40 group rounded-xl border">
      <summary className="text-foreground/85 hover:bg-muted/50 flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-[12px] font-semibold [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="px-1 pb-1">{children}</div>
    </details>
  );
}
