/**
 * UniversityCourseBrowser — duyệt môn của 1 trường kiểu Studocu (2026-05-28).
 *
 * Client component: search môn + tab [Phổ biến · A · B · C...] + grid folder
 * card. Tab chữ cái chỉ render letter THẬT có môn (tránh tab chết). "Phổ biến"
 * = sort theo doc_count.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Folder, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

type Course = { id: string; name: string; code: string | null; docCount: number };

const POPULAR = '__popular__';

/** Chữ cái đầu (bỏ dấu) để gom tab A-Z. */
function firstLetter(name: string): string {
  const c = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .trim()
    .charAt(0)
    .toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

export function UniversityCourseBrowser({ courses }: { courses: Course[] }) {
  const t = useT();
  const [q, setQ] = React.useState('');
  const [tab, setTab] = React.useState<string>(POPULAR);

  // Các chữ cái thật sự có môn → tab động
  const letters = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of courses) set.add(firstLetter(c.name));
    return [...set].sort();
  }, [courses]);

  const nq = q.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    let list = courses;
    if (nq) {
      list = list.filter((c) =>
        `${c.name} ${c.code ?? ''}`.toLowerCase().includes(nq),
      );
    } else if (tab !== POPULAR) {
      list = list.filter((c) => firstLetter(c.name) === tab);
    }
    // Phổ biến (mặc định, không search) → theo doc_count; còn lại → A-Z
    return [...list].sort((a, b) =>
      tab === POPULAR && !nq
        ? b.docCount - a.docCount
        : a.name.localeCompare(b.name, 'vi'),
    );
  }, [courses, nq, tab]);

  return (
    <div className="space-y-4">
      {/* Search môn trong trường */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('library.university.course_search')}
          className="w-full rounded-full border border-divider bg-card py-2.5 pl-11 pr-4 text-[13.5px] outline-none transition-colors focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
          aria-label={t('library.university.course_search')}
        />
      </div>

      {/* Tabs Phổ biến + A-Z (ẩn khi đang search) */}
      {!nq && letters.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setTab(POPULAR)}
            className={cn(
              'rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
              tab === POPULAR
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t('library.university.popular')}
          </button>
          {letters.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setTab(l)}
              className={cn(
                'min-w-[2rem] rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors',
                tab === l
                  ? 'bg-primary text-primary-foreground'
                  : 'text-primary/80 hover:bg-muted',
              )}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {/* Grid folder cards */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Link
              key={c.id}
              href={`/library/course/${c.id}`}
              className="group flex items-start gap-2.5 rounded-xl border border-divider bg-card p-3 transition-all hover:-translate-y-0.5 hover:border-discovery-500/30 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Folder className="mt-0.5 h-5 w-5 shrink-0 fill-emerald-500/20 text-emerald-600" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-snug group-hover:text-discovery-600">
                  {c.name}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {c.code && <span className="font-mono">{c.code}</span>}
                  <span>·</span>
                  <span className="tabular-nums">{c.docCount}</span>
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-[13px] text-muted-foreground">
          {t('library.university.no_course_match')}
        </p>
      )}
    </div>
  );
}
