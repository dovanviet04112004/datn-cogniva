/**
 * DuplicateWarning — Phase 2 Duplicate Detection UI (2026-05-27).
 *
 * Banner hiển thị khi doc có near-duplicate (sim ≥ 0.92). Liệt kê tối đa 3
 * doc tương tự + link xem nhanh. Client-only fetch để không block SSR.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { useT } from '@/lib/i18n/context';

type DupMatch = {
  id: string;
  title: string;
  similarity: number;
  isNearDuplicate: boolean;
};

export function DuplicateWarning({ docId }: { docId: string }) {
  const t = useT();
  const { data: matches = [] } = useQuery({
    queryKey: qk.libraryDocDuplicates(docId),
    queryFn: () =>
      apiGet<{ matches?: DupMatch[] }>(
        `/api/library/docs/${docId}/duplicates?nearOnly=true`,
      ).then((d) => d.matches ?? []),
    enabled: !!docId,
  });

  if (matches.length === 0) return null;

  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="flex-1">
        <p className="font-semibold text-amber-700 dark:text-amber-300">
          {t('library.duplicate.found').replace('{count}', String(matches.length))}
        </p>
        <p className="mt-0.5 text-[12px] text-amber-700/80 dark:text-amber-300/80">
          {t('library.duplicate.near')}
        </p>
        <ul className="mt-1.5 space-y-0.5">
          {matches.slice(0, 3).map((m) => (
            <li key={m.id}>
              <Link
                href={`/library/${m.id}`}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-amber-800 underline-offset-2 hover:underline dark:text-amber-200"
              >
                {m.title}
                <span className="font-mono text-[10.5px] opacity-70">
                  ({(m.similarity * 100).toFixed(0)}%)
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
