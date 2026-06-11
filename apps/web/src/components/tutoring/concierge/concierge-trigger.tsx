'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

import { ConciergePanel } from './concierge-panel';

type Props = {
  variant?: 'floating' | 'searchBar' | 'embedded';
};

export function ConciergeTrigger({ variant = 'floating' }: Props) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((s) => !s);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {variant === 'floating' && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'from-discovery-600 fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-gradient-to-br to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-xl transition-all hover:-translate-y-0.5 hover:shadow-2xl',
            open && 'pointer-events-none opacity-0',
          )}
          aria-label="Mở AI Concierge"
        >
          <Sparkles className="h-4 w-4" />
          <span className="hidden sm:inline">Hỏi AI Concierge</span>
          <kbd className="hidden rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px] sm:inline">
            ⌘J
          </kbd>
        </button>
      )}

      {variant === 'searchBar' && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border-discovery-500/20 from-discovery-500/5 via-card to-card shadow-soft hover:border-discovery-500/40 hover:shadow-elevated group flex w-full items-center gap-3 rounded-2xl border bg-gradient-to-r px-4 py-3 text-left transition-all"
        >
          <span className="bg-discovery-500/15 text-discovery-500 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="text-muted-foreground flex-1 truncate text-sm">
            <span className="text-discovery-700 dark:text-discovery-300 font-medium">
              Hỏi AI Concierge:
            </span>{' '}
            &quot;Tôi muốn học Toán lớp 11...&quot;
          </span>
          <kbd className="border-discovery-500/30 bg-card text-discovery-700 dark:text-discovery-300 hidden shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold sm:inline-block">
            ⌘J
          </kbd>
        </button>
      )}

      <ConciergePanel open={open} onOpenChange={setOpen} />
    </>
  );
}
