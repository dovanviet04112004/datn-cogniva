/**
 * BrowseDirectory — directory "Khám phá" kiểu Studocu (2026-05-28).
 *
 * Client component: 1 search bar lọc real-time + grid card trường (avatar chữ
 * cái + tên + N môn · M tài liệu) và grid môn chung. Thay dropdown cũ chật chội.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Building2, ChevronDown, GraduationCap, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

type Uni = {
  id: string;
  name: string;
  shortName: string | null;
  docCount: number;
  courseCount: number;
};
type Course = { id: string; name: string; code: string | null; docCount: number };

// Giới hạn hiển thị ban đầu — phần còn lại ẩn sau "Xem tất cả" để trang gọn
// khi nhiều trường/môn. Search vẫn lọc toàn bộ.
const UNI_LIMIT = 9;
const COURSE_LIMIT = 12;

// Palette avatar trường — hash theo id để mỗi trường 1 màu ổn định.
const AVATAR_COLORS = [
  'bg-discovery-500',
  'bg-sky-500',
  'bg-rose-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-fuchsia-500',
  'bg-indigo-500',
  'bg-teal-500',
];

function colorFor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function initials(u: Uni): string {
  const s = u.shortName || u.name;
  const letters = s
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!)
    .join('')
    .toUpperCase();
  return letters.slice(0, 3) || s.slice(0, 2).toUpperCase();
}

export function BrowseDirectory({
  universities,
  generalCourses,
}: {
  universities: Uni[];
  generalCourses: Course[];
}) {
  const t = useT();
  const [q, setQ] = React.useState('');
  const [uniAll, setUniAll] = React.useState(false);
  const [courseAll, setCourseAll] = React.useState(false);
  const nq = q.trim().toLowerCase();
  const searching = nq.length > 0;

  const unisFull = searching
    ? universities.filter((u) =>
        `${u.name} ${u.shortName ?? ''}`.toLowerCase().includes(nq),
      )
    : universities;
  const coursesFull = searching
    ? generalCourses.filter((c) =>
        `${c.name} ${c.code ?? ''}`.toLowerCase().includes(nq),
      )
    : generalCourses;

  // Khi search → hiện hết match; khi duyệt → cap đến khi bấm "Xem tất cả".
  const unis = searching || uniAll ? unisFull : unisFull.slice(0, UNI_LIMIT);
  const courses = searching || courseAll ? coursesFull : coursesFull.slice(0, COURSE_LIMIT);
  const uniHidden = unisFull.length - unis.length;
  const courseHidden = coursesFull.length - courses.length;

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('library.browse.search_placeholder')}
          className="w-full rounded-full border border-divider bg-card py-3 pl-11 pr-4 text-[14px] outline-none transition-colors focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
          aria-label={t('library.browse.search_placeholder')}
        />
      </div>

      {/* Trường */}
      {unisFull.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            {t('library.hub.browse_by_university')}
            <span className="font-mono tabular-nums text-muted-foreground/60">
              {unisFull.length}
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            {unis.map((u) => (
              <Link
                key={u.id}
                href={`/library/university/${u.id}`}
                className="group flex items-center gap-3 rounded-xl border border-divider bg-card p-3 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${colorFor(u.id)} text-[13px] font-bold text-white`}
                >
                  {initials(u)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold">
                    {u.name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {u.courseCount} {t('library.university.courses')} · {u.docCount}{' '}
                    {t('library.hub.stats.docs')}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          {!searching && (uniHidden > 0 || uniAll) && unisFull.length > UNI_LIMIT && (
            <ExpandToggle
              expanded={uniAll}
              hidden={unisFull.length - UNI_LIMIT}
              onToggle={() => setUniAll((v) => !v)}
            />
          )}
        </section>
      )}

      {/* Môn chung */}
      {coursesFull.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <GraduationCap className="h-3.5 w-3.5" />
            {t('library.hub.browse_by_course')}
            <span className="font-mono tabular-nums text-muted-foreground/60">
              {coursesFull.length}
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            {courses.map((c) => (
              <Link
                key={c.id}
                href={`/library/course/${c.id}`}
                className="group flex items-center justify-between gap-2 rounded-xl border border-divider bg-card p-3 transition-all hover:-translate-y-0.5 hover:border-discovery-500/30 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="min-w-0">
                  {c.code && (
                    <span className="block font-mono text-[10px] font-semibold text-discovery-600">
                      {c.code}
                    </span>
                  )}
                  <span className="block truncate text-[13px] font-medium">{c.name}</span>
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {c.docCount}
                </span>
              </Link>
            ))}
          </div>
          {!searching && (courseHidden > 0 || courseAll) && coursesFull.length > COURSE_LIMIT && (
            <ExpandToggle
              expanded={courseAll}
              hidden={coursesFull.length - COURSE_LIMIT}
              onToggle={() => setCourseAll((v) => !v)}
            />
          )}
        </section>
      )}

      {unisFull.length === 0 && coursesFull.length === 0 && (
        <p className="py-12 text-center text-[13px] text-muted-foreground">
          {t('library.browse.no_results')}
        </p>
      )}
    </div>
  );
}

/** Nút "Xem tất cả (N)" / "Thu gọn" cho mỗi section. */
function ExpandToggle({
  expanded,
  hidden,
  onToggle,
}: {
  expanded: boolean;
  hidden: number;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-primary"
    >
      {expanded
        ? t('library.browse.show_less')
        : t('library.browse.show_all').replace('{count}', `(${hidden})`)}
      <ChevronDown
        className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
      />
    </button>
  );
}
