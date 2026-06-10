/**
 * PageLoading — loading state chuẩn cho page/section.
 *
 * Trước đây mỗi page tự viết `<div>Đang tải...</div>` hoặc spinner inline →
 * style không nhất quán. Unify lại với 3 variant.
 *
 * Variant:
 *   - 'spinner' (default): icon Loader2 quay + label optional. Dùng cho
 *                          state loading nhanh < 1s.
 *   - 'skeleton'         : N skeleton row giả lập list item. Dùng cho list
 *                          load chậm — feel tốt hơn spinner.
 *   - 'card'             : 3 skeleton card layout grid — dùng cho dashboard/grid.
 *
 * Sử dụng:
 *   <PageLoading />                          // spinner mặc định
 *   <PageLoading label="Đang upload..." />   // spinner + label
 *   <PageLoading variant="skeleton" rows={5} />
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'spinner' | 'skeleton' | 'card';

type Props = {
  variant?: Variant;
  /** Label hiển thị dưới spinner. Optional. */
  label?: string;
  /** Số skeleton row (variant='skeleton') hoặc card (variant='card'). Default 4. */
  rows?: number;
  /** className thêm vào root. */
  className?: string;
};

export function PageLoading({
  variant = 'spinner',
  label,
  rows = 4,
  className,
}: Props) {
  if (variant === 'spinner') {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground',
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
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  // variant === 'card' — grid 3 column skeleton
  return (
    <div
      className={cn('grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3', className)}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Đang tải...'}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-lg border bg-muted/40"
        />
      ))}
    </div>
  );
}
