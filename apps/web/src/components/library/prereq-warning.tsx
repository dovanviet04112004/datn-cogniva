'use client';

import * as React from 'react';
import { Lightbulb } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

type PrereqResponse = {
  prereqs: string[];
  missing: string[];
  hasGap: boolean;
  difficulty: 'easy' | 'medium' | 'hard' | null;
};

const DIFFICULTY_META: Record<string, { labelKey: string; emoji: string; class: string }> = {
  easy: {
    labelKey: 'library.difficulty.easy',
    emoji: '🟢',
    class: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  },
  medium: {
    labelKey: 'library.difficulty.medium',
    emoji: '🟡',
    class: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
  },
  hard: {
    labelKey: 'library.difficulty.hard',
    emoji: '🔴',
    class: 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300',
  },
};

export function PrereqWarning({ docId }: { docId: string }) {
  const t = useT();
  const { data } = useQuery({
    queryKey: qk.libraryDocPrereq(docId),
    queryFn: () => apiGet<PrereqResponse>(`/api/library/docs/${docId}/prereq-check`),
    enabled: !!docId,
  });

  if (!data) return null;
  if (data.prereqs.length === 0 && !data.difficulty) return null;

  return (
    <div className="border-divider bg-card flex flex-col gap-2 rounded-xl border p-3">
      {data.difficulty && (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider',
              DIFFICULTY_META[data.difficulty]!.class,
            )}
          >
            {DIFFICULTY_META[data.difficulty]!.emoji} {t('library.prereq.difficulty_label')}{' '}
            {t(DIFFICULTY_META[data.difficulty]!.labelKey)}
          </span>
          {data.prereqs.length > 0 && (
            <span className="text-muted-foreground text-[10.5px]">
              {t('library.prereq.need_before_count').replace(
                '{count}',
                String(data.prereqs.length),
              )}
            </span>
          )}
        </div>
      )}

      {data.prereqs.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1.5 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider">
            <Lightbulb className="h-3 w-3" />
            {t('library.prereq.need_before')}
          </p>
          <ul className="flex flex-wrap gap-1">
            {data.prereqs.map((slug) => {
              const isMissing = data.missing.includes(slug);
              const label = slug.replace(/-/g, ' ');
              return (
                <li
                  key={slug}
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-[11px]',
                    isMissing
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
                  )}
                  title={
                    isMissing ? t('library.prereq.missing_atom') : t('library.prereq.have_atom')
                  }
                >
                  {isMissing ? '○' : '✓'} {label}
                </li>
              );
            })}
          </ul>
          {data.hasGap && (
            <p className="mt-1.5 text-[10.5px] text-amber-700/80 dark:text-amber-300/80">
              {t('library.prereq.gap_warning').replace('{count}', String(data.missing.length))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
