import Link from 'next/link';
import { FileText, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListToolbar, type ActiveFilterChip } from '@/components/tutoring/list-toolbar';
import { Pagination } from '@/components/tutoring/pagination';
import { LEVEL_NAMES, SUBJECT_BY_SLUG } from '@cogniva/db/taxonomy';
import { apiServer, apiServerOrNull } from '@/lib/api-server';
import { getServerT } from '@/lib/i18n/server';

import { DocCard, type DocCardData } from './doc-card';
import { UploadButton } from './upload-button';

type LibraryDocItem = {
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
  difficulty: string | null;
  isPremium: boolean;
  priceVnd: number | null;
  courseNameCache: string | null;
  createdAt: string;
};

const ALLOWED_PAGE_SIZES = [12, 24, 48, 96];
const DEFAULT_PAGE_SIZE = 24;

const SORT_KEYS = ['top', 'rating', 'popular', 'newest'] as const;

const DOC_TYPE_KEY: Record<string, string> = {
  lecture_notes: 'library.doctype.lecture_notes',
  summary: 'library.doctype.summary',
  exam: 'library.doctype.exam',
  exercise: 'library.doctype.exercise',
  solution: 'library.doctype.solution',
  reference_book: 'library.doctype.reference_book',
};

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? '', 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseStrArr(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIntArr(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter(Number.isFinite);
}

function parseDifficulty(raw: string | undefined): Array<'easy' | 'medium' | 'hard'> | undefined {
  if (!raw) return undefined;
  const tokens = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is 'easy' | 'medium' | 'hard' => s === 'easy' || s === 'medium' || s === 'hard');
  return tokens.length > 0 ? tokens : undefined;
}

export async function LibraryGrid({
  sp,
}: {
  sp: {
    q?: string;
    subject?: string;
    level?: string;
    grade?: string;
    docType?: string;
    language?: string;
    fileFormat?: string;
    difficulty?: string;
    university?: string;
    course?: string;
    sort?: string;
    page?: string;
    per?: string;
  };
}) {
  const t = await getServerT();
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const pageSize = parsePageSize(sp.per);
  const offset = (page - 1) * pageSize;

  const sortKey =
    sp.sort === 'rating' || sp.sort === 'popular' || sp.sort === 'newest'
      ? (sp.sort as 'rating' | 'popular' | 'newest')
      : 'top';

  const { items, total } = await apiServer<{ items: LibraryDocItem[]; total: number }>(
    '/api/library/search',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: sp.q,
        filters: {
          subjectSlug: sp.subject,
          level: sp.level,
          grade: parseIntArr(sp.grade),
          docType: parseStrArr(sp.docType),
          language: sp.language,
          fileFormat: parseStrArr(sp.fileFormat),
          difficulty: parseDifficulty(sp.difficulty),
          universityId: sp.university,
          courseId: sp.course,
        },
        sort: sortKey,
        limit: pageSize,
        offset,
      }),
    },
  );

  const docs: DocCardData[] = items.map((it) => ({
    id: it.id,
    title: it.title,
    description: it.description,
    subjectSlug: it.subjectSlug,
    level: it.level,
    grade: it.grade,
    docType: it.docType,
    language: it.language,
    tags: it.tags,
    fileFormat: it.fileFormat,
    pageCount: it.pageCount,
    previewThumbUrl: it.previewThumbUrl,
    aiSummary: it.aiSummary,
    ratingAvg: it.ratingAvg,
    ratingCount: it.ratingCount,
    workspaceImportCount: it.workspaceImportCount,
    uploaderName: it.uploaderName,
    badges: it.badges,
    difficulty: it.difficulty,
    isPremium: it.isPremium,
    priceVnd: it.priceVnd,
    courseNameCache: it.courseNameCache,
    createdAt: it.createdAt,
  }));

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  let universityLabel: string | null = null;
  let courseLabel: string | null = null;
  if (sp.university) {
    const detail = await apiServerOrNull<{ uni: { name: string; shortName: string | null } }>(
      `/api/library/universities/${sp.university}`,
    );
    universityLabel = detail?.uni.shortName || detail?.uni.name || null;
  }
  if (sp.course) {
    const c = await apiServerOrNull<{ name: string; code: string | null }>(
      `/api/library/courses/${sp.course}`,
    );
    courseLabel = c ? (c.code ? `${c.code} ${c.name}` : c.name) : null;
  }

  const activeFilters: ActiveFilterChip[] = [];
  if (sp.q) activeFilters.push({ key: 'q', label: `🔍 "${sp.q}"` });
  if (sp.university && universityLabel) {
    activeFilters.push({ key: 'university', label: `🏛 ${universityLabel}` });
  }
  if (sp.course && courseLabel) {
    activeFilters.push({ key: 'course', label: `🎓 ${courseLabel}` });
  }
  if (sp.subject) {
    const s = SUBJECT_BY_SLUG[sp.subject];
    activeFilters.push({ key: 'subject', label: s ? `${s.emoji} ${s.name}` : sp.subject });
  }
  if (sp.level) {
    activeFilters.push({
      key: 'level',
      label: LEVEL_NAMES[sp.level as keyof typeof LEVEL_NAMES] ?? sp.level,
    });
  }
  if (sp.grade) {
    activeFilters.push({ key: 'grade', label: `Lớp ${sp.grade}` });
  }
  if (sp.docType) {
    const labels = sp.docType
      .split(',')
      .map((dt) => (DOC_TYPE_KEY[dt] ? t(DOC_TYPE_KEY[dt]!) : dt))
      .join(' / ');
    activeFilters.push({ key: 'docType', label: labels });
  }
  if (sp.fileFormat) {
    activeFilters.push({
      key: 'fileFormat',
      label: sp.fileFormat.toUpperCase(),
    });
  }
  if (sp.difficulty) {
    const labels = sp.difficulty
      .split(',')
      .map((d) => ({ easy: 'Dễ', medium: 'Vừa', hard: 'Khó' })[d.trim()] ?? d)
      .join(' / ');
    activeFilters.push({ key: 'difficulty', label: `📊 ${labels}` });
  }

  const preservedParams: Record<string, string> = {};
  if (sp.q) preservedParams.q = sp.q;
  if (sp.subject) preservedParams.subject = sp.subject;
  if (sp.level) preservedParams.level = sp.level;
  if (sp.grade) preservedParams.grade = sp.grade;
  if (sp.docType) preservedParams.docType = sp.docType;
  if (sp.language) preservedParams.language = sp.language;
  if (sp.fileFormat) preservedParams.fileFormat = sp.fileFormat;
  if (sp.difficulty) preservedParams.difficulty = sp.difficulty;
  if (sp.university) preservedParams.university = sp.university;
  if (sp.course) preservedParams.course = sp.course;
  if (sp.sort) preservedParams.sort = sp.sort;

  return (
    <div className="space-y-4">
      <ListToolbar
        title={t('library.grid.title')}
        total={total}
        activeFilters={activeFilters}
        sortOptions={SORT_KEYS.map((k) => ({ value: k, label: t(`library.sort.${k}`) }))}
        currentSort={sortKey}
      />

      {docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t('library.empty.title')}
          description={
            activeFilters.length > 0
              ? `${activeFilters.length} filter · ${t('library.empty.clear_filter')}`
              : t('library.empty.title')
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {activeFilters.length > 0 && (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/library" className="gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t('library.empty.clear_filter')}
                  </Link>
                </Button>
              )}
              <UploadButton size="sm" label={t('library.empty.upload')} />
            </div>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {docs.map((d) => (
              <DocCard key={d.id} doc={d} />
            ))}
          </div>
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={total}
            pageSize={pageSize}
            defaultPageSize={DEFAULT_PAGE_SIZE}
            basePath="/library"
            preservedParams={preservedParams}
          />
        </>
      )}
    </div>
  );
}
