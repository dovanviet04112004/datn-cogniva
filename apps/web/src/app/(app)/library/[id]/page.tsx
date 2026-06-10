/**
 * /library/[id] — detail page V2 compact sidebar (2026-05-27).
 *
 * V2: Sidebar gọn lại 11→6 sections, gộp Quality+Stats+Badges thành hero card,
 * metadata thành icon-row inline thay vì table 8 dòng.
 */
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
import { auth } from '@/lib/auth';
import { checkDocAccess } from '@/lib/library/access';
import { getServerT } from '@/lib/i18n/server';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** Map docType slug → dict key. Label dịch qua t() tại call site. */
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

  // Phase 3 Bonus #12: nếu doc là remix → fetch source titles for attribution
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
        and(
          inArray(libraryDoc.id, doc.parentRemixDocIds),
          eq(libraryDoc.status, 'PUBLISHED'),
        ),
      );
  }

  const t = await getServerT();
  const subj = SUBJECT_BY_SLUG[doc.subjectSlug];
  const isProcessing = doc.status === 'PROCESSING';
  const isHidden = doc.status === 'HIDDEN';

  // University→Course breadcrumb — fetch tên trường nếu doc gắn university.
  let universityName: string | null = null;
  if (doc.universityId) {
    const [u] = await db
      .select({ name: libraryUniversity.name, shortName: libraryUniversity.shortName })
      .from(libraryUniversity)
      .where(eq(libraryUniversity.id, doc.universityId))
      .limit(1);
    universityName = u?.shortName || u?.name || null;
  }

  // Phase 4 Step 5 — premium gate
  const session = await auth.api.getSession({ headers: await headers() });
  const viewerId = session?.user.id ?? null;
  const accessInfo = await checkDocAccess(doc.id, viewerId);
  const isPremiumLocked =
    !!doc.isPremium &&
    !!doc.priceVnd &&
    doc.priceVnd > 0 &&
    !!accessInfo &&
    !accessInfo.access.allowed;

  // Track view history → feed "📖 Đọc tiếp" trên hub. Trước đây upsert nằm
  // trong GET /api/library/docs/[id] nhưng page server không gọi endpoint đó
  // nên không bao giờ ghi. Upsert trực tiếp ở đây (fire-and-forget, không await
  // block render). 1 row/(user × doc), update viewed_at mỗi lần mở.
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
      {/* Back link */}
      <Link
        href="/library"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
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

      {/* Phase 2 — Duplicate Detection */}
      <DuplicateWarning docId={doc.id} />

      {/* Phase 3 Bonus #12 — Remix attribution */}
      {parentRemixDocs.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-discovery-500/30 bg-discovery-500/5 p-3">
          <Layers className="mt-0.5 h-4 w-4 shrink-0 text-discovery-600" />
          <div className="text-[12.5px]">
            <p className="font-semibold text-discovery-700 dark:text-discovery-300">
              {t('library.detail.remix_from')} {parentRemixDocs.length} {t('library.detail.remix_sources')}
            </p>
            <ul className="mt-1 space-y-0.5">
              {parentRemixDocs.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/library/${p.id}`}
                    className="text-[11.5px] text-discovery-700 underline-offset-2 hover:underline dark:text-discovery-300"
                  >
                    → {p.title}
                  </Link>
                  {p.uploaderName && (
                    <span className="text-[11px] text-muted-foreground">
                      {' '}
                      · {p.uploaderName}
                    </span>
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

      {/* items-start: tránh PDF preview cell stretch theo khi sidebar (atom map
          expand) cao hơn. lg:sticky: sidebar dính top khi scroll xuống xem PDF.
          B3.16: trên mobile, sidebar (title + CTA Import + metadata) hiện TRƯỚC
          preview để user thao tác ngay không phải scroll qua PDF dài 1600px.
          Mobile fix: `min-w-0` để grid cell shrink đúng + text wrap (default
          grid item có min-content có thể overflow viewport). */}
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px] [&>*]:min-w-0">
        {/* Left: Preview — gate premium docs chưa mua */}
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
            /* Mobile fix: owner/PRO/purchased → unlock full N trang preview +
               annotation tất cả trang. Free chỉ thấy 5 trang đầu. */
            fullAccess={
              !!accessInfo &&
              accessInfo.access.allowed &&
              ['owner', 'pro', 'purchased'].includes(accessInfo.access.reason)
            }
          />
        )}
        </div>

        {/* Right: Sidebar V2 compact — 6 sections thay vì 11.
            B3.16: trên mobile order-1 (lên đầu), desktop order-2 (giữ vị trí right).
            (B4.20 reverted — sticky + nested scroll tạo 2 scrollbar gây UX rối,
             user reported "không hợp lí". Sidebar giờ scroll cùng page natural,
             desktop user dùng PDF preview internal scroll, không cần sticky.) */}
        <aside className="order-1 flex flex-col gap-3 lg:order-2">
          {/* ── Section 1: HERO — title + uploader inline + badges ── */}
          <section className="flex min-w-0 flex-col gap-2.5">
            {/* Mobile fix: break-words + min-w-0 cho title không overflow viewport */}
            {/* University → Course breadcrumb (clickable → landing pages) */}
            {(universityName || doc.courseNameCache) && (
              <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                {universityName && doc.universityId && (
                  <>
                    <Link
                      href={`/library/university/${doc.universityId}`}
                      className="font-medium text-foreground/70 hover:text-foreground hover:underline"
                    >
                      🏛 {universityName}
                    </Link>
                    {doc.courseNameCache && <span className="opacity-50">›</span>}
                  </>
                )}
                {doc.courseNameCache && doc.courseId && (
                  <Link
                    href={`/library/course/${doc.courseId}`}
                    className="rounded-md bg-discovery-500/10 px-1.5 py-0.5 font-medium text-discovery-700 hover:bg-discovery-500/20 dark:text-discovery-300"
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
              <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <Avatar className="h-5 w-5">
                  <AvatarImage src={doc.uploaderImage ?? undefined} />
                  <AvatarFallback className="text-[9px]">
                    {doc.uploaderName[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium text-foreground/85">{doc.uploaderName}</span>
                <span>·</span>
                <span>{new Date(doc.createdAt).toLocaleDateString('vi-VN')}</span>
              </div>
            )}
            {doc.badges && doc.badges.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {doc.badges.includes('outcome_verified') && (
                  <Badge className="h-5 gap-0.5 px-1.5 text-[10px] bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
                    <Award className="h-2.5 w-2.5" />
                    {t('library.badge.outcome_verified')}
                  </Badge>
                )}
                {doc.badges.includes('educator_approved') && (
                  <Badge className="h-5 gap-0.5 px-1.5 text-[10px] bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {t('library.badge.educator_approved')}
                  </Badge>
                )}
                {doc.badges.includes('syllabus_complete') && (
                  <Badge className="h-5 px-1.5 text-[10px] bg-discovery-500/15 text-discovery-700 hover:bg-discovery-500/20 dark:text-discovery-300">
                    🎯 {t('library.badge.syllabus_complete')}
                  </Badge>
                )}
                {doc.badges.includes('power_resource') && (
                  <Badge className="h-5 px-1.5 text-[10px] bg-sky-500/15 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300">
                    ⚡ {t('library.badge.power_resource')}
                  </Badge>
                )}
              </div>
            )}
          </section>

          {/* ── Section 2 (B4.23: PROMOTED UP): PRIMARY CTAs trước Stats ──
              User vào page muốn nhấn Import ngay, không phải scroll qua stats. */}
          <div className="flex flex-col gap-2">
            {isPremiumLocked && (
              <p className="rounded-md border border-discovery-500/30 bg-discovery-500/5 px-2 py-1.5 text-center text-[11px] text-discovery-700 dark:text-discovery-300">
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
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-divider bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" />
              {t('library.detail.download')}
            </a>
            <PodcastPlayer docId={doc.id} />
          </div>

          {/* ── Section 3: STATS CARD — Quality + Rating + Import + DL ── */}
          <section className="rounded-xl border border-divider bg-gradient-to-br from-card to-muted/20 p-3">
            {doc.qualityScore != null && Number(doc.qualityScore) > 0 && (
              <div className="mb-2.5 border-b border-divider/60 pb-2.5">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('library.detail.quality_score')}
                  </span>
                  <span className="font-mono text-[15px] font-bold tabular-nums">
                    {Number(doc.qualityScore).toFixed(1)}
                    <span className="text-[10px] font-normal text-muted-foreground">/100</span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-gradient-to-r from-discovery-500 to-sky-500 transition-all"
                    style={{ width: `${Math.min(100, Number(doc.qualityScore))}%` }}
                  />
                </div>
              </div>
            )}
            {/* Zero-state: doc mới chưa có tương tác → 1 dòng gọn thay lưới 0/–/0
                (tránh "lỗi giả" trên hàng nghìn doc seed mới). */}
            {doc.ratingCount === 0 &&
            doc.workspaceImportCount === 0 &&
            doc.downloadCount === 0 ? (
              <p className="flex items-center justify-center gap-1.5 py-1 text-[11.5px] text-muted-foreground">
                <Sparkles className="h-3 w-3 text-discovery-500" />
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
                <StatCell
                  value={String(doc.downloadCount)}
                  label={t('library.detail.download')}
                />
              </div>
            )}
          </section>

          {/* ── Section 3.5: Difficulty + Prerequisite (Bonus #13) ── */}
          <PrereqWarning docId={doc.id} />

          {/* B2.8: collapse các section ít dùng để sidebar đỡ dày.
              Atom map + Endorse default closed, user expand khi cần. */}
          <CollapsibleSection label={t('library.detail.atom_map')}>
            <DocAtomMap docId={doc.id} pageCount={doc.pageCount} />
          </CollapsibleSection>

          <CollapsibleSection label={t('library.detail.educator_confirm')}>
            <EndorseSection docId={doc.id} />
          </CollapsibleSection>

          {/* ── Section 5: AI summary + translate (Bonus #11) ── */}
          {doc.aiSummary && (
            <section className="rounded-xl border border-discovery-500/20 bg-discovery-500/5 p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-discovery-600">
                {t('library.detail.ai_summary')}
              </p>
              <TranslatableText
                docId={doc.id}
                text={doc.aiSummary}
                sourceLang={doc.language ?? 'vi'}
              />
            </section>
          )}

          {/* ── Section 6: META compact icon-row + tags + description ──
              B2.8: collapse default — user thỉnh thoảng mới tham khảo metadata. */}
          <CollapsibleSection label={t('library.detail.detail_info')}>
          <section className="rounded-xl border border-divider bg-card p-3">
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
                    : LEVEL_NAMES[doc.level as keyof typeof LEVEL_NAMES] ?? doc.level
                }
              />
              <MetaCell
                icon={<FileText className="h-3 w-3" />}
                label={`${doc.fileFormat.toUpperCase()} · ${doc.pageCount ?? '–'} ${t('library.card.pages')}`}
              />
              <MetaCell
                icon={<Globe className="h-3 w-3" />}
                label={doc.language === 'vi' ? t('library.detail.lang_vi') : t('library.detail.lang_en')}
              />
              <MetaCell
                icon={<Hash className="h-3 w-3" />}
                label={DOC_TYPE_KEY[doc.docType] ? t(DOC_TYPE_KEY[doc.docType]!) : doc.docType}
              />
              {doc.license && (
                <MetaCell
                  icon={<Scale className="h-3 w-3" />}
                  label={doc.license}
                />
              )}
            </div>
            {doc.tags && doc.tags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1 border-t border-divider/60 pt-2.5">
                {doc.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
            {doc.description && (
              <div className="mt-2.5 border-t border-divider/60 pt-2.5">
                <TranslatableText
                  docId={doc.id}
                  text={doc.description}
                  sourceLang={doc.language ?? 'vi'}
                  className="text-[12px] text-foreground/75"
                />
              </div>
            )}
          </section>
          </CollapsibleSection>
        </aside>
      </div>

      {/* Bonus #10 — Auto-Stitched Workspace */}
      <RelatedDocsSection sourceDocId={doc.id} sourceTitle={doc.title} />

      {/* Bonus #8 — Annotations / Page Notes (Phase 3) */}
      <AnnotationsSection docId={doc.id} />

      {/* Reviews */}
      <DocReviewSection docId={doc.id} />

      {/* B4.21: Mobile sticky CTA bottom — Import luôn visible khi user
          scroll xuống đọc reviews/annotations. Desktop ẩn (sidebar sticky đã có).
          Mobile fix: z-50 (cao hơn ConciergeTrigger z-40 nếu có), pb safe-area
          cho iPhone home indicator. */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 border-t border-divider bg-card/95 px-3 pt-2 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur-md lg:hidden"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto flex max-w-md items-center gap-2">
          {isPremiumLocked ? (
            <div className="flex flex-1 items-center justify-between gap-2 rounded-lg bg-discovery-500/10 px-3 py-1.5">
              <span className="text-[11px] font-semibold text-discovery-700 dark:text-discovery-300">
                🔒 {doc.priceVnd?.toLocaleString('vi-VN')}đ
              </span>
              <Button asChild size="sm" className="bg-discovery-600 hover:bg-discovery-700">
                <Link href={`/library/${doc.id}#preview`}>{t('library.detail.buy_now')}</Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-2">
              <ImportToWorkspaceButton
                docId={doc.id}
                disabled={isProcessing || isHidden}
              />
              <a
                href={`/api/library/docs/${doc.id}/download`}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-md border border-divider bg-card px-3 text-[12px] font-medium"
                aria-label={t('library.detail.download')}
              >
                <Download className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Spacer dưới page để không bị che bởi sticky bar mobile — 96px gồm
          ~56px bar height + ~40px safe-area */}
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
      <p className="font-mono text-[15px] font-bold tabular-nums leading-tight">
        {value}
      </p>
      <p className="mt-0.5 flex items-center justify-center gap-0.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </p>
    </div>
  );
}

function MetaCell({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-foreground/85">
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate font-medium">{label}</span>
    </div>
  );
}

/**
 * CollapsibleSection — B2.8: dùng `<details>` native (no JS, no client component)
 * để collapse các section ít dùng trong sidebar detail. Default closed.
 *
 * Lưu ý: server component có thể render trực tiếp vì `<details>` toggle qua
 * browser, không cần state React.
 */
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
    <details
      open={defaultOpen}
      className="group rounded-xl border border-divider bg-card/40"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-[12px] font-semibold text-foreground/85 hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <span className="text-muted-foreground transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="px-1 pb-1">{children}</div>
    </details>
  );
}
