import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'border-divider bg-surface-secondary/50 flex flex-col items-center justify-center rounded-2xl border text-center',
        compact ? 'px-6 py-10' : 'px-6 py-16',
        className,
      )}
    >
      <span className="from-primary/15 to-discovery-500/10 text-primary inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <p className="mt-4 text-sm font-semibold tracking-tight">{title}</p>
      {description && (
        <p className="text-muted-foreground mt-1.5 max-w-sm text-[13px] leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
