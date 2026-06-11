'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

type Props = {
  totalPages: number;
  currentPage: number;
  totalItems: number;
  pageSize: number;
  defaultPageSize: number;
  availablePageSizes?: number[];
  basePath: string;
  preservedParams: Record<string, string>;
};

const DEFAULT_PAGE_SIZES = [12, 24, 48, 96];

export function Pagination({
  totalPages,
  currentPage,
  totalItems,
  pageSize,
  defaultPageSize,
  availablePageSizes = DEFAULT_PAGE_SIZES,
  basePath,
  preservedParams,
}: Props) {
  const t = useT();

  const buildHref = React.useCallback(
    (page: number, size?: number) => {
      const params = new URLSearchParams(preservedParams);
      const effectiveSize = size ?? pageSize;
      if (effectiveSize !== defaultPageSize) {
        params.set('per', String(effectiveSize));
      }
      if (page > 1) params.set('page', String(page));
      const qs = params.toString();
      return qs ? `${basePath}?${qs}` : basePath;
    },
    [basePath, preservedParams, pageSize, defaultPageSize],
  );

  if (totalPages <= 1 && totalItems <= defaultPageSize) return null;

  const pages = buildPageRange(currentPage, totalPages);
  const firstItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <nav className="border-divider flex flex-col gap-3 border-t pt-4" aria-label={t('common.next')}>
      <div className="flex flex-wrap items-center gap-3 text-[11.5px]">
        <p className="text-muted-foreground">
          {t('common.showing')}{' '}
          <span className="text-foreground/80 font-mono font-semibold tabular-nums">
            {firstItem}–{lastItem}
          </span>{' '}
          {t('common.of')}{' '}
          <span className="text-foreground/80 font-mono font-semibold tabular-nums">
            {totalItems}
          </span>
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <PageSizePicker
            current={pageSize}
            options={availablePageSizes}
            buildHref={(size) => buildHref(1, size)}
          />
          {totalPages > 5 && (
            <JumpToPage
              currentPage={currentPage}
              totalPages={totalPages}
              buildHref={(p) => buildHref(p)}
            />
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 sm:justify-end">
          <PaginationLink
            href={currentPage > 1 ? buildHref(currentPage - 1) : null}
            prefetch={currentPage > 1}
            aria-label={t('common.prev')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span className="sr-only sm:not-sr-only sm:ml-1 sm:text-[11px]">
              {t('common.prev')}
            </span>
          </PaginationLink>

          <div className="hidden items-center gap-1 sm:flex">
            {pages.map((p, i) =>
              p === '...' ? (
                <span key={`ellipsis-${i}`} className="text-muted-foreground/50 px-1.5 text-xs">
                  …
                </span>
              ) : (
                <PaginationLink
                  key={p}
                  href={p === currentPage ? null : buildHref(p)}
                  active={p === currentPage}
                  prefetch={Math.abs(p - currentPage) === 1}
                >
                  {p}
                </PaginationLink>
              ),
            )}
          </div>

          <span className="inline-flex items-center px-3 text-xs font-medium tabular-nums sm:hidden">
            <span className="text-foreground">{currentPage}</span>
            <span className="text-muted-foreground/50 mx-1">/</span>
            <span className="text-muted-foreground">{totalPages}</span>
          </span>

          <PaginationLink
            href={currentPage < totalPages ? buildHref(currentPage + 1) : null}
            prefetch={currentPage < totalPages}
            aria-label={t('common.next')}
          >
            <span className="sr-only sm:not-sr-only sm:mr-1 sm:text-[11px]">
              {t('common.next')}
            </span>
            <ChevronRight className="h-3.5 w-3.5" />
          </PaginationLink>
        </div>
      )}
    </nav>
  );
}

function PaginationLink({
  href,
  active,
  prefetch = false,
  children,
  ...rest
}: {
  href: string | null;
  active?: boolean;
  prefetch?: boolean;
  children: React.ReactNode;
  'aria-label'?: string;
}) {
  const className = cn(
    'inline-flex h-8 min-w-[2rem] items-center justify-center rounded-md border px-2 text-xs font-medium tabular-nums transition-colors',
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : href === null
        ? 'border-divider bg-muted/30 text-muted-foreground/40 cursor-not-allowed'
        : 'border-divider bg-card text-foreground/80 hover:border-primary/40 hover:bg-primary/5 hover:text-primary',
  );
  if (href === null) {
    return (
      <span className={className} aria-disabled {...rest}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className} prefetch={prefetch} {...rest}>
      {children}
    </Link>
  );
}

function PageSizePicker({
  current,
  options,
  buildHref,
}: {
  current: number;
  options: number[];
  buildHref: (size: number) => string;
}) {
  const t = useT();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const triggerClass =
    'inline-flex items-center gap-1 rounded-md border border-divider bg-card px-2 py-1 text-[11.5px] font-medium transition-colors hover:border-primary/40 hover:bg-primary/5';

  if (!mounted) {
    return (
      <button type="button" className={triggerClass} aria-label={t('common.per_page')}>
        <span className="text-muted-foreground">{t('common.per_page')}:</span>
        <span className="font-mono tabular-nums">{current}</span>
        <ChevronDown className="h-3 w-3 opacity-50" />
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClass} aria-label={t('common.per_page')}>
          <span className="text-muted-foreground">{t('common.per_page')}:</span>
          <span className="font-mono tabular-nums">{current}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[110px]">
        {options.map((size) => (
          <DropdownMenuItem key={size} asChild>
            <Link
              href={buildHref(size)}
              className={cn(
                'cursor-pointer text-xs',
                size === current && 'bg-primary/5 text-primary',
              )}
            >
              <span className="font-mono tabular-nums">{size}</span>
              <span className="text-muted-foreground ml-1">{t('common.card_unit')}</span>
              {size === current && <span className="ml-auto">✓</span>}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function JumpToPage({
  currentPage,
  totalPages,
  buildHref,
}: {
  currentPage: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = React.useState(String(currentPage));

  React.useEffect(() => {
    setValue(String(currentPage));
  }, [currentPage]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseInt(value, 10);
    if (Number.isNaN(target)) {
      setValue(String(currentPage));
      return;
    }
    const clamped = Math.min(totalPages, Math.max(1, target));
    if (clamped === currentPage) return;
    router.push(buildHref(clamped));
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-1.5 text-[11.5px]">
      <label htmlFor="jump-to-page" className="text-muted-foreground">
        {t('common.go_to_page')}
      </label>
      <input
        id="jump-to-page"
        type="number"
        min={1}
        max={totalPages}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="border-divider bg-card focus:border-primary/50 focus:ring-primary/15 h-7 w-12 rounded-md border px-1.5 text-center font-mono text-xs tabular-nums tracking-tight outline-none transition-colors focus:ring-2"
        aria-label={`${t('common.go_to_page')} (max ${totalPages})`}
      />
      <span className="text-muted-foreground/60">/ {totalPages}</span>
      <button
        type="submit"
        className="border-divider bg-card hover:border-primary/40 hover:bg-primary/5 hover:text-primary rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide transition-colors"
      >
        {t('common.go')}
      </button>
    </form>
  );
}

function buildPageRange(current: number, total: number): Array<number | '...'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const out: Array<number | '...'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) out.push('...');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('...');

  out.push(total);
  return out;
}
