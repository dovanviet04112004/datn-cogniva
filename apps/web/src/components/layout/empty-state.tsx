import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'dashed' | 'card' | 'inline';

const variantMap: Record<Variant, string> = {
  dashed: 'rounded-2xl border border-dashed border-border bg-surface-secondary/40 px-6 py-14',
  card: 'rounded-2xl border border-divider bg-card shadow-soft px-6 py-12',
  inline: 'px-4 py-6',
};

type Props = {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  variant?: Variant;
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'dashed',
  className,
}: Props) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center overflow-hidden text-center',
        variantMap[variant],
        className,
      )}
    >
      {variant !== 'inline' && (
        <div
          aria-hidden
          className="bg-primary/10 pointer-events-none absolute -top-12 left-1/2 h-32 w-32 -translate-x-1/2 rounded-full blur-2xl"
        />
      )}

      <div className="relative">
        {Icon && (
          <div className="from-primary/15 to-primary/5 text-primary shadow-soft ring-primary/20 mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ring-1 ring-inset">
            <Icon className="h-6 w-6" aria-hidden="true" strokeWidth={1.75} />
          </div>
        )}
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        {description && (
          <p className="text-muted-foreground mx-auto mt-1.5 max-w-md text-sm leading-relaxed">
            {description}
          </p>
        )}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}
