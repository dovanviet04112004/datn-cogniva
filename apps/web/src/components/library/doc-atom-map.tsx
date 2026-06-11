'use client';

import * as React from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useT } from '@/lib/i18n/context';

type Atom = {
  id: string;
  atomText: string;
  atomSlug: string;
  pageNums: number[];
  difficulty: 'easy' | 'medium' | 'hard' | null;
  mastered: boolean;
};

type ApiResp = {
  atoms: Atom[];
  total: number;
  masteredCount: number;
};

const DIFFICULTY_COLOR: Record<string, string> = {
  easy: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  hard: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

const DIFFICULTY_LABEL_KEY: Record<string, string> = {
  easy: 'library.difficulty.easy',
  medium: 'library.difficulty.medium',
  hard: 'library.difficulty.hard',
};

export function DocAtomMap({
  docId,
  pageCount,
  onSmartReadChange,
}: {
  docId: string;
  pageCount: number | null;
  onSmartReadChange?: (masteredPages: number[]) => void;
}) {
  const t = useT();
  const { data, isLoading: loading } = useQuery({
    queryKey: qk.libraryDocAtoms(docId),
    queryFn: () => apiGet<ApiResp>(`/api/library/docs/${docId}/atoms`),
    enabled: !!docId,
  });
  const [smartRead, setSmartRead] = React.useState(true);
  const [showAll, setShowAll] = React.useState(false);

  React.useEffect(() => {
    if (!data || !onSmartReadChange) return;
    if (!smartRead) {
      onSmartReadChange([]);
      return;
    }
    const masteredPages = new Set<number>();
    for (const a of data.atoms) {
      if (a.mastered) for (const p of a.pageNums) masteredPages.add(p);
    }
    onSmartReadChange(Array.from(masteredPages).sort((a, b) => a - b));
  }, [data, smartRead, onSmartReadChange]);

  if (loading) {
    return (
      <section className="border-divider bg-card rounded-xl border p-3">
        <p className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-wider">
          {t('library.atommap.atoms')}
        </p>
        <div className="text-muted-foreground flex items-center gap-2 text-[12px]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('library.atommap.analyzing')}
        </div>
      </section>
    );
  }

  if (!data || data.atoms.length === 0) {
    return (
      <section className="border-divider bg-card rounded-xl border p-3">
        <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
          {t('library.atommap.atoms')}
        </p>
        <p className="text-muted-foreground text-[12px]">{t('library.atommap.empty')}</p>
      </section>
    );
  }

  const sorted = [...data.atoms].sort((a, b) => {
    if (a.mastered !== b.mastered) return a.mastered ? 1 : -1;
    return a.atomText.localeCompare(b.atomText, 'vi');
  });
  const visibleAtoms = showAll ? sorted : sorted.slice(0, 8);

  let masteredPages = 0;
  if (data.masteredCount > 0 && pageCount) {
    const pageSet = new Set<number>();
    for (const a of data.atoms) {
      if (a.mastered) for (const p of a.pageNums) pageSet.add(p);
    }
    masteredPages = pageSet.size;
  }
  const timeSavedPct =
    pageCount && masteredPages > 0 ? Math.round((masteredPages / pageCount) * 100) : 0;

  return (
    <section className="border-discovery-500/30 bg-discovery-500/5 rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="text-discovery-600 dark:text-discovery-400 h-3.5 w-3.5" />
          <p className="text-discovery-700 dark:text-discovery-300 text-[10px] font-semibold uppercase tracking-wider">
            {t('library.atommap.mastered_count')
              .replace('{mastered}', String(data.masteredCount))
              .replace('{total}', String(data.total))}
          </p>
        </div>
        {pageCount && timeSavedPct > 0 && (
          <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            {t('library.atommap.time_saved').replace('{pct}', String(timeSavedPct))}
          </span>
        )}
      </div>

      {data.masteredCount > 0 && (
        <label className="border-discovery-500/20 bg-background mb-3 flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-2 text-[12px]">
          <div>
            <p className="font-medium">{t('library.atommap.smart_reading')}</p>
            <p className="text-muted-foreground text-[10.5px]">
              {t('library.atommap.smart_reading_desc').replace('{count}', String(masteredPages))}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={smartRead}
            aria-label={t('library.atommap.smart_reading_aria')}
            onClick={(e) => {
              e.preventDefault();
              setSmartRead((v) => !v);
            }}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
              smartRead ? 'bg-discovery-600' : 'bg-muted',
            )}
          >
            <span
              className={cn(
                'bg-background pointer-events-none inline-block h-4 w-4 rounded-full shadow-sm transition-transform',
                smartRead ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </button>
        </label>
      )}

      <ul className={cn('space-y-1', showAll && 'max-h-[480px] overflow-y-auto pr-1')}>
        {visibleAtoms.map((atom) => (
          <li
            key={atom.id}
            className={cn(
              'flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors',
              atom.mastered
                ? 'text-muted-foreground/70 bg-emerald-500/5 line-through'
                : 'hover:bg-discovery-500/10',
            )}
          >
            <span
              className={cn(
                'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                atom.mastered
                  ? 'border-emerald-500 bg-emerald-500/20'
                  : 'border-discovery-500/40 bg-background',
              )}
              aria-label={
                atom.mastered ? t('library.atommap.mastered') : t('library.atommap.not_mastered')
              }
            >
              {atom.mastered && (
                <Check className="h-3 w-3 text-emerald-700 dark:text-emerald-300" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words">{atom.atomText}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                {atom.difficulty && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-4 border-transparent px-1.5 text-[9.5px]',
                      DIFFICULTY_COLOR[atom.difficulty],
                    )}
                  >
                    {t(DIFFICULTY_LABEL_KEY[atom.difficulty]!)}
                  </Badge>
                )}
                <span className="text-muted-foreground text-[10px]">
                  {t('library.atommap.page_prefix')}
                  {atom.pageNums.slice(0, 3).join(', ')}
                  {atom.pageNums.length > 3 && '...'}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {sorted.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="text-discovery-700 hover:bg-discovery-500/10 dark:text-discovery-300 mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium"
        >
          {showAll ? (
            <>
              <ChevronUp className="h-3 w-3" />
              {t('library.atommap.collapse')}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              {t('library.atommap.show_all').replace('{count}', String(sorted.length))}
            </>
          )}
        </button>
      )}
    </section>
  );
}
