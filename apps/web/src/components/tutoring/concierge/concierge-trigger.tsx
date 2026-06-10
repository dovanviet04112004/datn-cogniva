/**
 * ConciergeTrigger — V4 T1 (2026-05-22).
 *
 * 3 trigger entry cho ConciergePanel:
 *   1. Floating gradient pill ở bottom-right (mọi tutoring page)
 *   2. Inline smart search bar (hub `/tutoring` top)
 *   3. Cmd+J / Ctrl+J global shortcut
 *
 * Component mount panel + manage open state. Trigger render tuỳ variant prop.
 */
'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

import { ConciergePanel } from './concierge-panel';

type Props = {
  /**
   * 'floating': pill cố định bottom-right (1 instance / page)
   * 'searchBar': render inline search bar
   * 'embedded': chỉ provide panel + Cmd+J, không render trigger
   */
  variant?: 'floating' | 'searchBar' | 'embedded';
};

export function ConciergeTrigger({ variant = 'floating' }: Props) {
  const [open, setOpen] = React.useState(false);

  // Cmd+J / Ctrl+J shortcut global
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
            'fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-discovery-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-xl transition-all hover:shadow-2xl hover:-translate-y-0.5',
            open && 'opacity-0 pointer-events-none',
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
          className="group flex w-full items-center gap-3 rounded-2xl border border-discovery-500/20 bg-gradient-to-r from-discovery-500/5 via-card to-card px-4 py-3 text-left shadow-soft transition-all hover:border-discovery-500/40 hover:shadow-elevated"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-discovery-500/15 text-discovery-500">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 truncate text-sm text-muted-foreground">
            <span className="font-medium text-discovery-700 dark:text-discovery-300">
              Hỏi AI Concierge:
            </span>{' '}
            &quot;Tôi muốn học Toán lớp 11...&quot;
          </span>
          <kbd className="hidden shrink-0 rounded-md border border-discovery-500/30 bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold text-discovery-700 sm:inline-block dark:text-discovery-300">
            ⌘J
          </kbd>
        </button>
      )}

      <ConciergePanel open={open} onOpenChange={setOpen} />
    </>
  );
}
