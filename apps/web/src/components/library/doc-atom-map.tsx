/**
 * DocAtomMap — Pillar #3 atom map panel (Phase 2, 2026-05-27).
 *
 * Hiển thị danh sách atoms của doc:
 *   ☑ checkmark nếu user đã master (mastery.score ≥ 0.7 + embedding sim ≥ 0.78)
 *   ☐ unchecked nếu chưa master
 *   - difficulty badge (easy/medium/hard)
 *   - page numbers atom xuất hiện (clickable scroll PDF tới page)
 *
 * Toggle "Smart Reading" — emit onSmartReadChange(masteredPages[]) lên parent
 * để PDF viewer hide các pages đã master.
 *
 * Fetch /api/library/docs/[id]/atoms client-side để có session cookie cho
 * mastery overlay (server component không gửi cookie).
 */
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
  /** Callback emit list page nums đã mastered để PDF viewer skip. */
  onSmartReadChange?: (masteredPages: number[]) => void;
}) {
  const t = useT();
  const { data, isLoading: loading } = useQuery({
    queryKey: qk.libraryDocAtoms(docId),
    queryFn: () => apiGet<ApiResp>(`/api/library/docs/${docId}/atoms`),
    enabled: !!docId,
  });
  const [smartRead, setSmartRead] = React.useState(true); // default ON theo spec
  const [showAll, setShowAll] = React.useState(false);

  // Emit smart read changes lên parent
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
      <section className="rounded-xl border border-divider bg-card p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('library.atommap.atoms')}
        </p>
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('library.atommap.analyzing')}
        </div>
      </section>
    );
  }

  if (!data || data.atoms.length === 0) {
    return (
      <section className="rounded-xl border border-divider bg-card p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('library.atommap.atoms')}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {t('library.atommap.empty')}
        </p>
      </section>
    );
  }

  // Sort: chưa master trước (highlight cái cần học), mastered xuống cuối
  const sorted = [...data.atoms].sort((a, b) => {
    if (a.mastered !== b.mastered) return a.mastered ? 1 : -1;
    return a.atomText.localeCompare(b.atomText, 'vi');
  });
  const visibleAtoms = showAll ? sorted : sorted.slice(0, 8);

  // Compute time-saved estimate cho smart-read
  let masteredPages = 0;
  if (data.masteredCount > 0 && pageCount) {
    const pageSet = new Set<number>();
    for (const a of data.atoms) {
      if (a.mastered) for (const p of a.pageNums) pageSet.add(p);
    }
    masteredPages = pageSet.size;
  }
  const timeSavedPct =
    pageCount && masteredPages > 0
      ? Math.round((masteredPages / pageCount) * 100)
      : 0;

  return (
    <section className="rounded-xl border border-discovery-500/30 bg-discovery-500/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-discovery-600 dark:text-discovery-400" />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-discovery-700 dark:text-discovery-300">
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

      {/* Smart Reading toggle */}
      {data.masteredCount > 0 && (
        <label className="mb-3 flex cursor-pointer items-center justify-between rounded-lg border border-discovery-500/20 bg-background px-2.5 py-2 text-[12px]">
          <div>
            <p className="font-medium">{t('library.atommap.smart_reading')}</p>
            <p className="text-[10.5px] text-muted-foreground">
              {t('library.atommap.smart_reading_desc').replace('{count}', String(masteredPages))}
            </p>
          </div>
          {/* Compact toggle button (no Radix Switch dep) */}
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
                'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
                smartRead ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </button>
        </label>
      )}

      {/* Atom list — khi expanded cap max-height + scroll trong list để
          tránh sidebar dài quá khi có 20+ atoms */}
      <ul
        className={cn(
          'space-y-1',
          showAll && 'max-h-[480px] overflow-y-auto pr-1',
        )}
      >
        {visibleAtoms.map((atom) => (
          <li
            key={atom.id}
            className={cn(
              'flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors',
              atom.mastered
                ? 'bg-emerald-500/5 text-muted-foreground/70 line-through'
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
              aria-label={atom.mastered ? t('library.atommap.mastered') : t('library.atommap.not_mastered')}
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
                <span className="text-[10px] text-muted-foreground">
                  {t('library.atommap.page_prefix')}{atom.pageNums.slice(0, 3).join(', ')}
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
          className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium text-discovery-700 hover:bg-discovery-500/10 dark:text-discovery-300"
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
