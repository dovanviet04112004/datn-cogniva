import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'spinner' | 'skeleton' | 'card';

type Props = {
  variant?: Variant;
  label?: string;
  rows?: number;
  className?: string;
};

export function PageLoading({ variant = 'spinner', label, rows = 4, className }: Props) {
  if (variant === 'spinner') {
    return (
      <div
        className={cn(
          'text-muted-foreground flex flex-col items-center justify-center gap-2 py-12',
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        {label && <p className="text-sm">{label}</p>}
      </div>
    );
  }

  if (variant === 'skeleton') {
    return (
      <div
        className={cn('space-y-3', className)}
        role="status"
        aria-live="polite"
        aria-label={label ?? 'Đang tải...'}
      >
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="bg-muted/40 h-16 animate-pulse rounded-lg border" />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn('grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3', className)}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Đang tải...'}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-muted/40 h-40 animate-pulse rounded-lg border" />
      ))}
    </div>
  );
}
