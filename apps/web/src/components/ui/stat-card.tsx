import * as React from 'react';
import { type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export function StatCard({
  icon: Icon,
  tint,
  tintText,
  accent,
  label,
  value,
  hint,
  className,
}: {
  icon?: LucideIcon;
  tint?: string;
  tintText?: string;
  accent?: string;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  const badgeBg = accent ? cn('bg-gradient-to-br', accent) : tint;
  const haloBg = accent ? cn('bg-gradient-to-br', accent) : tint;
  return (
    <div
      className={cn(
        'group/stat border-divider bg-card/70 shadow-soft duration-base ease-expo-out hover:border-foreground/15 hover:shadow-elevated relative overflow-hidden rounded-2xl border p-4 backdrop-blur-sm transition-all hover:-translate-y-0.5 sm:p-5',
        className,
      )}
    >
      <span
        aria-hidden
        className="via-foreground/15 duration-base pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent opacity-0 transition-opacity group-hover/stat:opacity-100"
      />
      {haloBg && (
        <div
          aria-hidden
          className={cn(
            'duration-base pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-50 blur-2xl transition-all group-hover/stat:scale-110 group-hover/stat:opacity-90',
            haloBg,
          )}
        />
      )}
      <div className="relative flex items-center justify-between gap-2">
        {Icon && (
          <span
            className={cn(
              'ring-border/50 duration-base flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset transition-transform group-hover/stat:scale-105',
              badgeBg,
              tintText,
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={2} />
          </span>
        )}
        <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-[0.12em]">
          {label}
        </p>
      </div>
      <div className="relative mt-3.5 flex items-baseline gap-1.5">
        <p className="text-3xl font-bold tabular-nums leading-none tracking-tight">{value}</p>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </div>
      {haloBg && (
        <span
          aria-hidden
          className={cn(
            'duration-slow ease-expo-out pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 opacity-70 transition-transform group-hover/stat:scale-x-100',
            haloBg,
          )}
        />
      )}
    </div>
  );
}
