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

const UNI_LIMIT = 9;
const COURSE_LIMIT = 12;

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
    ? universities.filter((u) => `${u.name} ${u.shortName ?? ''}`.toLowerCase().includes(nq))
    : universities;
  const coursesFull = searching
    ? generalCourses.filter((c) => `${c.name} ${c.code ?? ''}`.toLowerCase().includes(nq))
    : generalCourses;

  const unis = searching || uniAll ? unisFull : unisFull.slice(0, UNI_LIMIT);
  const courses = searching || courseAll ? coursesFull : coursesFull.slice(0, COURSE_LIMIT);
  const uniHidden = unisFull.length - unis.length;
  const courseHidden = coursesFull.length - courses.length;

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('library.browse.search_placeholder')}
          className="border-divider bg-card focus:border-primary/50 focus:ring-primary/10 w-full rounded-full border py-3 pl-11 pr-4 text-[14px] outline-none transition-colors focus:ring-4"
          aria-label={t('library.browse.search_placeholder')}
        />
      </div>

      {unisFull.length > 0 && (
        <section>
          <h2 className="text-muted-foreground mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
            <Building2 className="h-3.5 w-3.5" />
            {t('library.hub.browse_by_university')}
            <span className="text-muted-foreground/60 font-mono tabular-nums">
              {unisFull.length}
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            {unis.map((u) => (
              <Link
                key={u.id}
                href={`/library/university/${u.id}`}
                className="border-divider bg-card hover:border-primary/30 hover:shadow-soft focus-visible:ring-primary/50 focus-visible:ring-offset-background group flex items-center gap-3 rounded-xl border p-3 transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${colorFor(u.id)} text-[13px] font-bold text-white`}
                >
                  {initials(u)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold">{u.name}</span>
                  <span className="text-muted-foreground block text-[11px]">
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

      {coursesFull.length > 0 && (
        <section>
          <h2 className="text-muted-foreground mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
            <GraduationCap className="h-3.5 w-3.5" />
            {t('library.hub.browse_by_course')}
            <span className="text-muted-foreground/60 font-mono tabular-nums">
              {coursesFull.length}
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            {courses.map((c) => (
              <Link
                key={c.id}
                href={`/library/course/${c.id}`}
                className="border-divider bg-card hover:border-discovery-500/30 hover:shadow-soft focus-visible:ring-primary/50 focus-visible:ring-offset-background group flex items-center justify-between gap-2 rounded-xl border p-3 transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                <span className="min-w-0">
                  {c.code && (
                    <span className="text-discovery-600 block font-mono text-[10px] font-semibold">
                      {c.code}
                    </span>
                  )}
                  <span className="block truncate text-[13px] font-medium">{c.name}</span>
                </span>
                <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[10px] tabular-nums">
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
        <p className="text-muted-foreground py-12 text-center text-[13px]">
          {t('library.browse.no_results')}
        </p>
      )}
    </div>
  );
}

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
      className="text-muted-foreground hover:text-primary mt-3 inline-flex items-center gap-1 text-[12px] font-medium transition-colors"
    >
      {expanded
        ? t('library.browse.show_less')
        : t('library.browse.show_all').replace('{count}', `(${hidden})`)}
      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
    </button>
  );
}
