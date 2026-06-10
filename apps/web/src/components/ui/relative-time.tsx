/**
 * RelativeTime — render relative time (vd "2d ago") safe hydration.
 *
 * Vấn đề: `formatRelativeTime()` dùng `Date.now()` trong render, server time
 * khác client time → React hydration mismatch warning.
 *
 * Fix: SSR + first CSR render absolute date (deterministic), useEffect set
 * mounted=true sau hydration → re-render với relative format. Người dùng
 * không cảm nhận sự khác biệt (cả 2 đều là valid time display).
 *
 * Cách dùng:
 *   <RelativeTime date={workspace.createdAt} />     ← string ISO hoặc Date
 *
 * `suppressHydrationWarning` thêm vào span để tránh React log warning về
 * differs giữa initial render (placeholder) và post-mount (real value).
 */
'use client';

import * as React from 'react';
import { formatRelativeTime } from '@/lib/utils';

type Props = {
  date: string | Date;
  /** className passthrough vào <span>. */
  className?: string;
};

export function RelativeTime({ date, className }: Props) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Pre-mount (SSR + first CSR): render fallback deterministic
  // (ISO date YYYY-MM-DD) — không phụ thuộc Date.now(), không có locale.
  if (!mounted) {
    const d = typeof date === 'string' ? new Date(date) : date;
    const iso = d.toISOString().slice(0, 10);
    return (
      <span className={className} suppressHydrationWarning>
        {iso}
      </span>
    );
  }

  return (
    <span className={className} suppressHydrationWarning>
      {formatRelativeTime(date)}
    </span>
  );
}
