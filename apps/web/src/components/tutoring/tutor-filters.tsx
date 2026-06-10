/**
 * TutorFilters — filter bar cho /tutors browse.
 *
 * State stored ở URL searchParams (server SSR drives results). Client sync
 * filter UI → router.push(?subject=...).
 *
 * Filter:
 *   - subjectSlug (select)
 *   - level (chỉ enable khi subject chọn, lọc theo subject.levels)
 *   - modality (chip toggle)
 */
'use client';

import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Check, ChevronDown, Filter, Search, X } from 'lucide-react';

// Import từ subpath taxonomy — file thuần data, không pull postgres driver.
// Tránh "Module not found: 'fs'" khi client bundle bundle cả @cogniva/db.
import {
  ALL_SUBJECTS,
  LEVEL_NAMES,
  MODALITY_NAMES,
  SUBJECT_BY_SLUG,
} from '@cogniva/db/taxonomy';
import type { SubjectLevel } from '@cogniva/db/taxonomy';

import { cn } from '@/lib/utils';

type Props = {
  initial: {
    subject?: string;
    level?: string;
    modality?: string;
    minRate?: string;
    maxRate?: string;
  };
};

const MODALITIES = ['ONLINE', 'OFFLINE_HN', 'OFFLINE_HCM', 'HYBRID'] as const;

export function TutorFilters({ initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const updateFilter = (key: string, value: string | null) => {
    const params = new URLSearchParams();
    // Preserve other filters
    for (const [k, v] of Object.entries(initial)) {
      if (k !== key && v) params.set(k, v);
    }
    if (value) params.set(key, value);
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ''}`);
  };

  const clearAll = () => {
    router.push(pathname);
  };

  const activeSubject = initial.subject
    ? SUBJECT_BY_SLUG[initial.subject]
    : undefined;
  const levelOptions = activeSubject?.levels ?? [];
  const hasFilters = !!(
    initial.subject ||
    initial.level ||
    initial.modality ||
    initial.minRate ||
    initial.maxRate
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 pr-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Filter className="h-3 w-3" />
          Lọc
        </div>

        {/* Subject select */}
        <SelectChip
          label="Môn"
          value={initial.subject}
          displayValue={activeSubject ? `${activeSubject.emoji} ${activeSubject.name}` : null}
          options={[
            { value: '', label: 'Tất cả môn' },
            ...ALL_SUBJECTS.map((s) => ({
              value: s.slug,
              label: `${s.emoji} ${s.name}`,
            })),
          ]}
          onChange={(v) => {
            updateFilter('subject', v || null);
            // Reset level khi đổi môn
            if (initial.level && v && !SUBJECT_BY_SLUG[v]?.levels.includes(initial.level as SubjectLevel)) {
              updateFilter('level', null);
            }
          }}
        />

        {/* Level select — chỉ enable khi có subject */}
        {activeSubject && (
          <SelectChip
            label="Cấp"
            value={initial.level}
            displayValue={initial.level ? LEVEL_NAMES[initial.level as SubjectLevel] : null}
            options={[
              { value: '', label: 'Tất cả cấp' },
              ...levelOptions.map((l) => ({
                value: l,
                label: LEVEL_NAMES[l],
              })),
            ]}
            onChange={(v) => updateFilter('level', v || null)}
          />
        )}

        {/* Modality chips */}
        <div className="flex items-center gap-1.5">
          {MODALITIES.map((m) => {
            const active = initial.modality === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => updateFilter('modality', active ? null : m)}
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-all',
                  active
                    ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/30'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {MODALITY_NAMES[m]}
              </button>
            );
          })}
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Xoá lọc
          </button>
        )}
      </div>
    </div>
  );
}

/** Bỏ dấu + thường hoá để lọc "giai tich" khớp "Giải tích". */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * SelectChip — chip lọc dạng combobox gõ-để-lọc (thay <select> cứng).
 * Trigger giữ look chip; mở ra panel có ô search (chỉ hiện khi list dài) +
 * danh sách lọc bỏ dấu. Giữ nguyên signature props nên call-site không đổi.
 */
function SelectChip({
  label,
  value,
  displayValue,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  displayValue: string | null;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const hasValue = !!value;
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Ô search chỉ cần khi list dài (môn ~20+); list ngắn (cấp) thì khỏi.
  const searchable = options.length > 8;

  const filtered = React.useMemo(() => {
    const nq = norm(q);
    if (!nq) return options;
    return options.filter((o) => norm(o.label).includes(nq));
  }, [q, options]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQ('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-2 text-[11.5px] font-medium transition-colors',
          hasValue
            ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/30'
            : 'bg-muted/40 text-muted-foreground hover:bg-muted',
        )}
      >
        {displayValue ?? `${label}: tất cả`}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-52 overflow-hidden rounded-xl border border-divider bg-card shadow-elevated">
          {searchable && (
            <div className="relative border-b border-divider p-1.5">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Tìm ${label.toLowerCase()}…`}
                className="w-full rounded-lg bg-background py-1.5 pl-8 pr-2 text-[12px] outline-none"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-center text-[11.5px] text-muted-foreground">
                Không có kết quả
              </p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQ('');
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-muted"
                >
                  <span className="truncate">
                    {o.value ? o.label : `${label}: tất cả`}
                  </span>
                  {o.value === (value ?? '') && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
