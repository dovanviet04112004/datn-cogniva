'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  BrainCircuit,
  FileText,
  ListChecks,
  Loader2,
  Network,
  NotebookPen,
  Search,
  SearchX,
  Sparkles,
} from 'lucide-react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type { SearchResult } from '@cogniva/shared';

const TYPE_ICON: Record<SearchResult['type'], typeof FileText> = {
  document: FileText,
  concept: Network,
  flashcard: BrainCircuit,
  quiz: ListChecks,
  note: NotebookPen,
};

const TYPE_LABEL: Record<SearchResult['type'], string> = {
  document: 'Documents',
  concept: 'Concepts',
  flashcard: 'Flashcards',
  quiz: 'Quizzes',
  note: 'Notes',
};

const QUICK_LINKS = [
  { label: 'Workspaces (chat + Studio)', href: '/workspaces', icon: BrainCircuit },
  { label: 'Tạo workspace mới', href: '/workspaces', icon: Sparkles },
  { label: 'Ôn flashcard hôm nay', href: '/flashcards/review', icon: ListChecks },
] as const;

export function CommandPaletteButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [isMac, setIsMac] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setIsMac(typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac'));
  }, []);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: qk.search(debouncedQuery),
    queryFn: () =>
      apiGet<{ results: SearchResult[] }>(
        `/api/search?q=${encodeURIComponent(debouncedQuery)}&limit=8`,
      ).then((d) => d.results ?? []),
    enabled: debouncedQuery.length > 0,
    placeholderData: keepPreviousData,
  });
  const results = debouncedQuery ? (data ?? []) : [];
  const loading = isFetching && debouncedQuery.length > 0;

  const grouped = React.useMemo(() => {
    const m = new Map<SearchResult['type'], SearchResult[]>();
    for (const r of results) {
      const arr = m.get(r.type) ?? [];
      arr.push(r);
      m.set(r.type, arr);
    }
    return m;
  }, [results]);

  const navigate = (href: string) => {
    router.push(href);
    setOpen(false);
    setQuery('');
    setDebouncedQuery('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative flex h-9 w-full max-w-md items-center">
          <Search className="text-text-muted pointer-events-none absolute left-3.5 h-4 w-4" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false);
                inputRef.current?.blur();
              }
            }}
            placeholder="Tìm tài liệu, khái niệm, flashcard..."
            className="border-input bg-surface/60 shadow-soft duration-base ease-expo-out placeholder:text-text-muted hover:border-border/80 focus-visible:border-primary/40 focus-visible:bg-surface focus-visible:ring-primary/15 flex h-9 w-full rounded-xl border pl-10 pr-16 text-sm outline-none transition-all focus-visible:ring-4"
          />
          <kbd
            suppressHydrationWarning
            className="border-divider bg-surface-secondary text-text-muted pointer-events-none absolute right-3 hidden select-none items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-tight sm:flex"
          >
            {isMac ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (inputRef.current && e.target instanceof Node && inputRef.current.contains(e.target)) {
            e.preventDefault();
          }
        }}
        className="w-[--radix-popover-trigger-width] min-w-[var(--radix-popover-trigger-width)] overflow-hidden p-0"
        style={{
          width: 'var(--radix-popover-trigger-width)',
          minWidth: 'min(28rem, 95vw)',
        }}
      >
        <Command shouldFilter={false} className="flex flex-col">
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            {loading && (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Đang tìm...
              </div>
            )}

            {!loading && !query && (
              <div className="space-y-1">
                <p className="text-muted-foreground px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider">
                  Gợi ý nhanh
                </p>
                {QUICK_LINKS.map((link) => {
                  const Icon = link.icon;
                  return (
                    <Command.Item
                      key={link.label}
                      value={link.label}
                      onSelect={() => navigate(link.href)}
                      className="text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
                    >
                      <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
                      <span>{link.label}</span>
                    </Command.Item>
                  );
                })}
              </div>
            )}

            {!loading && query && results.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <SearchX className="text-muted-foreground/50 h-7 w-7" />
                <p className="text-sm font-medium">Không có kết quả</p>
                <p className="text-muted-foreground max-w-xs text-xs">
                  Không tìm thấy &ldquo;
                  <span className="text-foreground font-medium">{query}</span>
                  &rdquo;
                </p>
              </div>
            )}

            {!loading &&
              [...grouped.entries()].map(([type, items]) => {
                const Icon = TYPE_ICON[type];
                return (
                  <Command.Group
                    key={type}
                    heading={TYPE_LABEL[type]}
                    className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1"
                  >
                    {items.map((item) => (
                      <Command.Item
                        key={`${item.type}-${item.id}`}
                        value={`${item.type}-${item.id}`}
                        onSelect={() => navigate(item.href)}
                        className="text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground flex cursor-pointer items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors"
                      >
                        <Icon className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-normal">{item.label}</p>
                          {item.sublabel && (
                            <p className="text-muted-foreground truncate text-xs">
                              {item.sublabel}
                            </p>
                          )}
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
