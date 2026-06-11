'use client';

import * as React from 'react';
import { formatRelativeTime } from '@/lib/utils';

type Props = {
  date: string | Date;
  className?: string;
};

export function RelativeTime({ date, className }: Props) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

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
