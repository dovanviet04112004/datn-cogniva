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
        'animate-fade-in-up border-divider from-card via-card to-surface-secondary shadow-elevated relative overflow-hidden rounded-2xl border bg-gradient-to-br px-7 py-8 sm:px-9 sm:py-10',
        className,
      )}
    >
      <div aria-hidden className="bg-aurora pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="via-foreground/15 pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
      />
      {decoration}
      <div
        aria-hidden
        className="bg-primary/18 pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full blur-3xl"
      />
      <div
        aria-hidden
        className="bg-discovery-500/12 pointer-events-none absolute -bottom-24 left-1/4 h-48 w-48 rounded-full blur-3xl"
      />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3.5">
          {eyebrow && (
            <div className="border-primary/20 bg-primary/5 shadow-soft inline-flex items-center gap-2 rounded-full border px-3 py-1 backdrop-blur-sm">
              {EyebrowIcon && <EyebrowIcon className="text-primary h-3.5 w-3.5" />}
              <span className="text-primary text-[11px] font-semibold uppercase tracking-[0.2em]">
                {eyebrow}
              </span>
            </div>
          )}
          <h1 className="text-3xl font-bold leading-[1.05] tracking-tight sm:text-4xl">{title}</h1>
          {description && (
            <p className="text-muted-foreground max-w-xl text-[15px] leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {children && <div className="w-full shrink-0 sm:w-auto">{children}</div>}
      </div>
    </header>
  );
}
