import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { PageHero } from './page-hero';

type Size = 'narrow' | 'default' | 'wide' | 'full';

const sizeMap: Record<Size, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-5xl',
  wide: 'max-w-6xl',
  full: 'max-w-none',
};

type Props = {
  eyebrow?: React.ReactNode;
  eyebrowIcon?: LucideIcon;
  hero?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  size?: Size;
  padded?: boolean;
  className?: string;
  headerClassName?: string;
  children: React.ReactNode;
};

export function PageShell({
  eyebrow,
  eyebrowIcon,
  hero = false,
  title,
  description,
  action,
  size = 'default',
  padded = true,
  className,
  headerClassName,
  children,
}: Props) {
  const hasHeader = Boolean(eyebrow || title || description || action);

  return (
    <div className={cn('mx-auto w-full space-y-6', sizeMap[size], padded && 'p-6', className)}>
      {hasHeader &&
        (hero && title ? (
          <PageHero
            eyebrow={eyebrow}
            eyebrowIcon={eyebrowIcon}
            title={title}
            description={description}
            className={headerClassName}
          >
            {action}
          </PageHero>
        ) : (
          <header
            className={cn(
              'flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
              headerClassName,
            )}
          >
            <div className="min-w-0 space-y-1.5">
              {eyebrow && (
                <div className="text-primary inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]">
                  {eyebrow}
                </div>
              )}
              {title && (
                <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">{title}</h1>
              )}
              {description && (
                <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
                  {description}
                </p>
              )}
            </div>
            {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
          </header>
        ))}
      {children}
    </div>
  );
}
