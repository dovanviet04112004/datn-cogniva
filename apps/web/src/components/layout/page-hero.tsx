import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export function PageHero({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  description,
  children,
  decoration,
  className,
}: {
  eyebrow?: React.ReactNode;
  eyebrowIcon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  decoration?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'animate-fade-in-up border-divider from-card via-card to-surface-secondary shadow-soft relative overflow-hidden rounded-2xl border bg-gradient-to-br px-6 py-6 sm:px-8 sm:py-7',
        className,
      )}
    >
      <div aria-hidden className="bg-aurora pointer-events-none absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="via-foreground/12 pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
      />
      {decoration}
      <div
        aria-hidden
        className="bg-primary/12 pointer-events-none absolute -right-24 -top-28 h-56 w-56 rounded-full blur-3xl"
      />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          {eyebrow && (
            <div className="text-primary inline-flex items-center gap-1.5">
              {EyebrowIcon && <EyebrowIcon className="h-3.5 w-3.5" strokeWidth={2} />}
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                {eyebrow}
              </span>
            </div>
          )}
          <h1 className="text-2xl font-bold leading-[1.1] tracking-tight sm:text-3xl">{title}</h1>
          {description && (
            <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">{description}</p>
          )}
        </div>
        {children && <div className="w-full shrink-0 sm:w-auto">{children}</div>}
      </div>
    </header>
  );
}
