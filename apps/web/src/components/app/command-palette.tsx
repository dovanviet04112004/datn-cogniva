/**
 * Command Palette — Cmd+K (Ctrl+K trên Windows) global search.
 *
 * UX:
 *   - Bấm Cmd+K hoặc click search input trong topbar → mở dialog overlay.
 *   - Gõ keyword → debounce 200ms → GET /api/search?q=...
 *   - Kết quả nhóm theo type (Documents/Concepts/Flashcards/Quizzes/Notes).
 *   - Enter / click → navigate đến href + đóng dialog.
 *   - Esc / click outside → đóng.
 *
 * Dùng `cmdk` library — accessible keyboard nav + filter ready out of the box.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { BookOpen, BrainCircuit, FileText, ListChecks, Network, NotebookPen, Search } from 'lucide-react';

import type { SearchResult } from '@/app/api/search/route';

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

type Props = {
  /** Mở dialog từ ngoài (vd: click search trong topbar). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CommandPalette({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Đăng ký Cmd+K / Ctrl+K toggle (ngay cả khi dialog đóng)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  // Debounce search
  React.useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(query)}&limit=8`)
        .then((r) => r.json())
        .then((d: { results: SearchResult[] }) => setResults(d.results ?? []))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Reset khi mở
  React.useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
    }
  }, [open]);

  // Group kết quả theo type để render section
  const grouped = React.useMemo(() => {
    const m = new Map<SearchResult['type'], SearchResult[]>();
    for (const r of results) {
      const arr = m.get(r.type) ?? [];
      arr.push(r);
      m.set(r.type, arr);
    }
    return m;
  }, [results]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={() => onOpenChange(false)}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[10vh]"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-lg border bg-popover text-popover-foreground shadow-2xl"
      >
        <Command shouldFilter={false} className="flex flex-col">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Tìm documents, concepts, flashcards, quizzes, notes..."
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
              Esc
            </kbd>
          </div>
          <Command.List className="max-h-[400px] overflow-y-auto p-2">
            {loading && (
              <Command.Loading>
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Đang tìm...
                </p>
              </Command.Loading>
            )}
            {!loading && query && results.length === 0 && (
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                Không có kết quả cho &ldquo;{query}&rdquo;
              </Command.Empty>
            )}
            {!loading && !query && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Gõ để tìm trong workspace
              </p>
            )}
            {[...grouped.entries()].map(([type, items]) => {
              const Icon = TYPE_ICON[type];
              return (
                <Command.Group
                  key={type}
                  heading={TYPE_LABEL[type]}
                  className="text-xs text-muted-foreground"
                >
                  {items.map((item) => (
                    <Command.Item
                      key={`${item.type}-${item.id}`}
                      value={`${item.type}-${item.id}`}
                      onSelect={() => {
                        router.push(item.href);
                        onOpenChange(false);
                      }}
                      className="flex cursor-pointer items-start gap-2 rounded-md px-3 py-2 text-sm text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{item.label}</p>
                        {item.sublabel && (
                          <p className="truncate text-xs text-muted-foreground">
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
      </div>
    </div>
  );
}

/** Trigger button cho topbar — open command palette + render dialog. */
export function CommandPaletteButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex h-9 w-full max-w-md items-center rounded-md border border-input bg-background pl-9 pr-3 text-left text-sm shadow-sm transition-colors hover:bg-muted/40"
      >
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">Search documents, concepts, flashcards...</span>
        <kbd className="pointer-events-none absolute right-3 hidden select-none items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:flex">
          {typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
            ? '⌘K'
            : 'Ctrl+K'}
        </kbd>
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}

// Avoid unused import warning for BookOpen (alias dùng trong tương lai)
void BookOpen;
