import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type Segment = {
  href?: string;
  label: React.ReactNode;
};

type Props = {
  segments?: Segment[];
  children?: React.ReactNode;
  className?: string;
};

export function Breadcrumbs({ segments, children, className }: Props) {
  if (children) {
    const items = React.Children.toArray(children).filter(Boolean);
    return (
      <nav
        aria-label="Breadcrumb"
        className={cn('text-muted-foreground flex items-center gap-1.5 text-xs', className)}
      >
        {items.map((child, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />}
            {child}
          </React.Fragment>
        ))}
      </nav>
    );
  }

  if (!segments?.length) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('text-muted-foreground flex items-center gap-1.5 text-xs', className)}
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />}
            {seg.href && !isLast ? (
              <Link href={seg.href} className="hover:text-foreground truncate transition-colors">
                {seg.label}
              </Link>
            ) : (
              <span
                className={cn('truncate', isLast && 'text-foreground font-medium')}
                aria-current={isLast ? 'page' : undefined}
              >
                {seg.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
