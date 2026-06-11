'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, LayoutGrid, List, X } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

export type SortOption = {
  value: string;
  label: string;
};

export type ActiveFilterChip = {
  key: string;
  label: string;
};

export function ListToolbar({
  title,
  total,
  activeFilters,
  sortOptions,
  currentSort,
  viewMode,
  onViewMode,
}: {
  title: string;
  total: number;
  activeFilters: ActiveFilterChip[];
  sortOptions: SortOption[];
  currentSort?: string;
  viewMode?: 'grid' | 'list';
  onViewMode?: (m: 'grid' | 'list') => void;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useT();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const updateParam = (key: string, value: string | null) => {
    const url = new URL(window.location.href);
    if (value === null || value === '') {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
    router.push(url.pathname + url.search);
  };

  const currentSortLabel =
    sortOptions.find((o) => o.value === currentSort)?.label ?? sortOptions[0]?.label ?? 'Sort';

  const clearAll = () => {
    const url = new URL(window.location.href);
    const tab = url.searchParams.get('tab');
    url.search = '';
    if (tab) url.searchParams.set('tab', tab);
    router.push(url.pathname + url.search);
  };

  return (
    <div className="space-y-2.5">
      <SectionHeading
        className="mb-0"
        count={total}
        action={
          <div className="flex items-center gap-2">
            {viewMode && onViewMode && (
              <div className="border-divider bg-card flex items-center gap-0.5 rounded-md border p-0.5">
                <button
                  type="button"
                  onClick={() => onViewMode('grid')}
                  aria-label="Grid view"
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded transition-colors',
                    viewMode === 'grid'
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onViewMode('list')}
                  aria-label="List view"
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded transition-colors',
                    viewMode === 'list'
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {mounted ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                    <span className="text-muted-foreground">{t('common.sort')}:</span>
                    <span className="font-medium">{currentSortLabel}</span>
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {sortOptions.map((opt) => (
                    <DropdownMenuItem
                      key={opt.value}
                      onClick={() => updateParam('sort', opt.value)}
                      className={cn(
                        'text-xs',
                        currentSort === opt.value && 'bg-primary/5 text-primary',
                      )}
                    >
                      {opt.label}
                      {currentSort === opt.value && <span className="ml-auto">✓</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled>
                <span className="text-muted-foreground">Sắp xếp:</span>
                <span className="font-medium">{currentSortLabel}</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            )}
          </div>
        }
      >
        {title}
      </SectionHeading>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-[11px] uppercase tracking-wider">
            {t('common.filter')}:
          </span>
          {activeFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => updateParam(f.key, null)}
              className="group/chip border-primary/25 bg-primary/5 text-primary hover:border-primary/50 hover:bg-primary/10 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors"
            >
              <span>{f.label}</span>
              <X className="h-2.5 w-2.5 opacity-60 group-hover/chip:opacity-100" />
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="text-muted-foreground hover:text-foreground text-[11px] font-medium underline-offset-2 hover:underline"
          >
            {t('common.clear_all')}
          </button>
        </div>
      )}
    </div>
  );
}
