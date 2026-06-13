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
  eyebrowIcon: EyebrowIcon,
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
    <div
      className={cn('mx-auto w-full space-y-5', sizeMap[size], padded && 'px-6 py-5', className)}
    >
      {hasHeader &&
        (hero && title ? (
          <PageHero
            eyebrow={eyebrow}
            eyebrowIcon={EyebrowIcon}
            title={title}
            description={description}
            className={headerClassName}
          >
            {action}
          </PageHero>
        ) : (
          <header
            className={cn(
              'border-divider flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
              headerClassName,
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                {EyebrowIcon && (
                  <span className="bg-primary/10 text-primary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                    <EyebrowIcon className="h-4 w-4" strokeWidth={2} />
                  </span>
                )}
                <div className="min-w-0">
                  {title && (
                    <h1 className="truncate text-lg font-semibold leading-tight tracking-tight sm:text-xl">
                      {title}
                    </h1>
                  )}
                  {description && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[13px] leading-snug">
                      {description}
                    </p>
                  )}
                </div>
              </div>
            </div>
            {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
          </header>
        ))}
      {children}
    </div>
  );
}
