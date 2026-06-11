import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export function SectionHeading({
  children,
  count,
  action,
  icon: Icon,
  className,
}: {
  children: React.ReactNode;
  count?: number | string | null;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-center gap-3', className)}>
      <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold tracking-tight">
        {Icon && <Icon className="text-muted-foreground h-4 w-4" strokeWidth={2} aria-hidden />}
        {children}
      </h2>
      {count !== null && count !== undefined && count !== '' && (
        <span className="border-divider bg-muted/50 text-muted-foreground rounded-full border px-1.5 py-0.5 text-[11px] tabular-nums">
          {count}
        </span>
      )}
      <span aria-hidden className="from-border h-px flex-1 bg-gradient-to-r to-transparent" />
      {action}
    </div>
  );
}
