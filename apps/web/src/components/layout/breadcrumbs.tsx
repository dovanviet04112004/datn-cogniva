/**
 * Breadcrumbs — đường dẫn navigation cho page nested.
 *
 * Dùng 2 cách:
 *
 * 1. Auto-mode (default) — pass `segments` array, component tự render:
 *      <Breadcrumbs segments={[
 *        { href: '/workspaces', label: 'Workspaces' },
 *        { label: workspace.name },  // segment cuối không cần href
 *      ]} />
 *
 * 2. Children-mode — pass JSX để custom render (links + icons):
 *      <Breadcrumbs>
 *        <Link href="/groups">Groups</Link>
 *        <span>...</span>
 *      </Breadcrumbs>
 *
 * Pattern: dùng trong PageShell header — đặt phía trên title cho page nested
 * (workspaces/[id], groups/[id], documents/[id], exams nested...).
 */
import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type Segment = {
  /** Link href. Bỏ qua nếu là segment cuối (current page). */
  href?: string;
  /** Label hiển thị. Bắt buộc. */
  label: React.ReactNode;
};

type Props = {
  /** Array segment để auto-render. Bỏ qua nếu dùng children. */
  segments?: Segment[];
  /** Custom render — override segments. Tách bằng ChevronRight tự động. */
  children?: React.ReactNode;
  className?: string;
};

export function Breadcrumbs({ segments, children, className }: Props) {
  if (children) {
    // Children-mode: tách array, chèn separator giữa mỗi child
    const items = React.Children.toArray(children).filter(Boolean);
    return (
      <nav
        aria-label="Breadcrumb"
        className={cn(
          'flex items-center gap-1.5 text-xs text-muted-foreground',
          className,
        )}
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
      className={cn(
        'flex items-center gap-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />}
            {seg.href && !isLast ? (
              <Link
                href={seg.href}
                className="truncate transition-colors hover:text-foreground"
              >
                {seg.label}
              </Link>
            ) : (
              <span
                className={cn(
                  'truncate',
                  isLast && 'font-medium text-foreground',
                )}
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
