/**
 * DocCard — Library V1 (2026-05-22).
 *
 * Card hiển thị 1 library doc trong grid. Click → /library/[id].
 *
 * Design: format icon + thumbnail + title + meta + badges + import CTA.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  FileImage,
  FileText,
  GraduationCap,
  ImportIcon,
  Lock,
  Star,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { BADGE_META, type LibraryBadgeKey } from '@/lib/library/badge-labels';
import { useT } from '@/lib/i18n/context';
import { LEVEL_NAMES, SUBJECT_BY_SLUG } from '@cogniva/db/taxonomy';

export type DocCardData = {
  id: string;
  title: string;
  description: string | null;
  subjectSlug: string;
  level: string;
  grade: number | null;
  docType: string;
  language: string;
  tags: string[];
  fileFormat: string;
  pageCount: number | null;
  previewThumbUrl: string | null;
  aiSummary: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  workspaceImportCount: number;
  uploaderName: string | null;
  badges: string[];
  /** Phase 3 Bonus #13 — easy/medium/hard. */
  difficulty?: string | null;
  /** Phase 4 Step 5 — premium price gating. */
  isPremium?: boolean;
  priceVnd?: number | null;
  /** University→Course model — tên course (vd "Hệ thống nhúng"). */
  courseNameCache?: string | null;
  createdAt: string | Date;
};

const DIFFICULTY_META: Record<string, { label: string; class: string }> = {
  easy: { label: 'Dễ', class: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  medium: { label: 'Vừa', class: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  hard: { label: 'Khó', class: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
};

const FORMAT_ICON: Record<string, React.ReactNode> = {
  pdf: <FileText className="h-3 w-3 text-rose-600" />,
  docx: <FileText className="h-3 w-3 text-sky-600" />,
  image: <FileImage className="h-3 w-3 text-discovery-600" />,
};

const DOC_TYPE_LABEL: Record<string, string> = {
  lecture_notes: 'Bài giảng',
  summary: 'Đề cương',
  exam: 'Đề thi',
  exercise: 'Bài tập',
  solution: 'Lời giải',
  reference_book: 'Sách tham khảo',
  thesis: 'Luận văn',
  handout: 'Slide',
  mind_map: 'Sơ đồ',
  other: 'Khác',
};


export function DocCard({ doc }: { doc: DocCardData }) {
  const subj = SUBJECT_BY_SLUG[doc.subjectSlug];
  const formatIcon = FORMAT_ICON[doc.fileFormat] ?? <FileText className="h-3 w-3" />;
  // Track img load error → swap sang placeholder để tránh browser show alt text
  // overlap với badges (lỗi khi external URL như DiceBear trả 400).
  const [thumbErrored, setThumbErrored] = React.useState(false);
  const showThumb = doc.previewThumbUrl && !thumbErrored;
  const t = useT();

  // B3.14: tooltip native browser hiển thị AI summary đầy đủ khi user hover lâu
  // (không cần Radix Tooltip — title attribute đủ cho card preview).
  const tooltipText = doc.aiSummary
    ? `${doc.title}\n\n${doc.aiSummary}`
    : doc.title;

  return (
    <Link
      href={`/library/${doc.id}`}
      title={tooltipText}
      className="group/c flex flex-col gap-3 overflow-hidden rounded-2xl border border-divider bg-card p-4 shadow-soft transition-all duration-base ease-expo-out hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* Thumbnail */}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-gradient-to-br from-muted to-muted/50">
        {showThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={doc.previewThumbUrl!}
            alt={doc.title}
            className="h-full w-full object-cover object-top transition-transform group-hover/c:scale-[1.02]"
            loading="lazy"
            onError={() => setThumbErrored(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground/40">
            <FileText className="h-12 w-12" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">
              {doc.fileFormat}
            </span>
          </div>
        )}
        {/* Watermark */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/40 to-transparent px-2 py-1">
          <span className="text-[8px] font-medium uppercase tracking-wider text-white/70">
            Cogniva Library
          </span>
        </div>
        {/* Format badge */}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-card/95 px-1.5 py-0.5 text-[10px] font-semibold uppercase backdrop-blur-sm">
          {formatIcon}
          {doc.fileFormat}
        </span>
        {/* Page count */}
        {doc.pageCount && (
          <span className="absolute right-2 top-2 rounded-md bg-card/95 px-1.5 py-0.5 font-mono text-[10px] backdrop-blur-sm">
            {doc.pageCount} trang
          </span>
        )}
        {/* Premium chip — Phase 4 Step 5 */}
        {doc.isPremium && doc.priceVnd && doc.priceVnd > 0 && (
          <div className="absolute inset-x-2 bottom-6 flex justify-center">
            <span className="inline-flex items-center gap-1 rounded-full bg-discovery-600/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-md backdrop-blur-sm">
              <Lock className="h-2.5 w-2.5" />
              {t('library.card.premium')} · {doc.priceVnd.toLocaleString('vi-VN')}đ
            </span>
          </div>
        )}
        {/* Difficulty pill bottom-left — B2.6: rời khỏi meta row để giảm noise */}
        {doc.difficulty && DIFFICULTY_META[doc.difficulty] && (
          <span
            className={cn(
              'absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm',
              doc.difficulty === 'easy'
                ? 'bg-emerald-500/90 text-white'
                : doc.difficulty === 'medium'
                  ? 'bg-amber-500/90 text-white'
                  : 'bg-rose-500/90 text-white',
            )}
            aria-label={t(`library.difficulty.${doc.difficulty}`)}
          >
            {t(`library.difficulty.${doc.difficulty}`)}
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-tight tracking-tight">
        {doc.title}
      </h3>

      {/* Course chip — University→Course model. Ưu tiên hiện course name. */}
      {doc.courseNameCache && (
        <span className="inline-flex w-fit items-center gap-1 rounded-md bg-discovery-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-discovery-700 dark:text-discovery-300">
          <GraduationCap className="h-3 w-3 shrink-0" />
          <span className="truncate">{doc.courseNameCache}</span>
        </span>
      )}

      {/* Meta row — B2.6: bỏ difficulty (đã move vào thumbnail overlay) */}
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-0.5">
          {subj?.emoji} {subj?.name ?? doc.subjectSlug}
        </span>
        <span>·</span>
        <span>
          {doc.grade
            ? `${t('library.card.grade')} ${doc.grade}`
            : LEVEL_NAMES[doc.level as keyof typeof LEVEL_NAMES] ?? doc.level}
        </span>
        <span>·</span>
        <span className="rounded bg-muted px-1.5 py-0 text-[10px]">
          {t(`library.doctype.${doc.docType}`)}
        </span>
      </div>

      {/* Badges — B2.6: limit 2 thay vì 3 để giảm visual noise */}
      {doc.badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {doc.badges.slice(0, 2).map((b) => {
            const bd = BADGE_META[b as LibraryBadgeKey];
            if (!bd) return null;
            return (
              <Badge
                key={b}
                variant="outline"
                className={cn('gap-0.5 px-1.5 py-0 text-[9.5px] font-semibold', bd.class)}
              >
                <span>{bd.emoji}</span>
                {t(`library.badge.${b}.short`)}
              </Badge>
            );
          })}
          {doc.badges.length > 2 && (
            <span className="text-[9.5px] text-muted-foreground/70">
              +{doc.badges.length - 2}
            </span>
          )}
        </div>
      )}

      {/* AI summary preview */}
      {doc.aiSummary && (
        <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {doc.aiSummary}
        </p>
      )}

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-divider pt-2.5">
        <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
          {doc.ratingAvg ? (
            <span className="inline-flex items-center gap-0.5">
              <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
              <span className="font-mono font-semibold">{doc.ratingAvg.toFixed(1)}</span>
              <span>({doc.ratingCount})</span>
            </span>
          ) : (
            <span className="italic">{t('library.card.new')}</span>
          )}
          {doc.workspaceImportCount > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span className="inline-flex items-center gap-0.5">
                <ImportIcon className="h-2.5 w-2.5" />
                {doc.workspaceImportCount}
              </span>
            </>
          )}
        </div>
        {doc.uploaderName && (
          <span className="truncate text-[10px] text-muted-foreground/70">
            {doc.uploaderName}
          </span>
        )}
      </div>
    </Link>
  );
}
