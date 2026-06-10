/**
 * PageShell — wrapper layout chuẩn cho mọi page trong (app)/.
 *
 * Trước đây mỗi page tự khai báo container + header riêng → 4 pattern khác nhau:
 *   - max-w-6xl / max-w-5xl / max-w-4xl / max-w-3xl với p-6 hoặc py-8.
 * PageShell unify lại thành 1 chỗ — đổi padding/width toàn app chỉ cần sửa
 * file này.
 *
 * Props:
 *   - title       : H1 hiển thị header (optional — page editor full-bleed có thể bỏ).
 *   - description : Subtitle muted dưới title.
 *   - action      : Button/element nằm bên phải header (ví dụ "+ New").
 *   - size        : 'narrow' (max-w-3xl, settings/forms) | 'default' (max-w-5xl)
 *                   | 'wide' (max-w-6xl, dashboard nhiều card) | 'full' (no cap).
 *   - padded      : false → bỏ padding ngoài (cho editor/canvas full-bleed).
 *
 * Sử dụng:
 *   <PageShell title="Documents" description="..." action={<Button>+ New</Button>}>
 *     {children}
 *   </PageShell>
 */
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
  /** Eyebrow nhỏ uppercase phía trên title (vd "AI Learning OS"). Optional. */
  eyebrow?: React.ReactNode;
  /** Icon lucide trước eyebrow (chỉ dùng khi hero). */
  eyebrowIcon?: LucideIcon;
  /**
   * `hero` → render header dạng banner PREMIUM (aurora mesh + glow + title to
   * gradient) qua PageHero thay vì header phẳng. Dùng cho trang hub/landing.
   */
  hero?: boolean;
  /** Tiêu đề H1 chính. Bỏ qua nếu không cần header (page custom). */
  title?: React.ReactNode;
  /** Mô tả phụ dưới title, font nhỏ hơn, màu muted. */
  description?: React.ReactNode;
  /** Action element bên phải header (button, link). */
  action?: React.ReactNode;
  /** Kích thước max-width container. Default 'default' (max-w-5xl). */
  size?: Size;
  /** Override container padding. Default true (p-6). */
  padded?: boolean;
  /** Custom className thêm vào root container. */
  className?: string;
  /** Custom className cho header wrapper (vd: thêm border-b). */
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
    <div
      className={cn(
        'mx-auto w-full space-y-6',
        sizeMap[size],
        padded && 'p-6',
        className,
      )}
    >
      {hasHeader &&
        (hero && title ? (
          // Banner premium dùng chung — mọi trang hub/landing nhìn đồng bộ.
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
                <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                  {eyebrow}
                </div>
              )}
              {title && (
                <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">
                  {title}
                </h1>
              )}
              {description && (
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
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
