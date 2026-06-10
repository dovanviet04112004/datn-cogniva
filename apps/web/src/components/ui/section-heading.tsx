/**
 * SectionHeading — tiêu đề mục DÙNG CHUNG toàn app.
 *
 * Thay các bản copy hardcode per-page (kiểu "— LABEL" gạch tí hon
 * `h-px w-6 from-primary/60 to-transparent` + uppercase tracking) — vốn nằm rải
 * rác ~15 file nên sửa style phải đi từng trang. Giờ 1 component, đổi 1 chỗ là
 * cả hệ thống theo.
 *
 * Style: title đậm rõ + count chip (optional) + hairline kéo hết hàng + slot
 * action bên phải. Presentational (không hook) → dùng được cả Server lẫn Client
 * Component.
 *
 * Usage:
 *   <SectionHeading>Tổng quan</SectionHeading>
 *   <SectionHeading count={items.length} action={<Button>…</Button>}>Tài liệu</SectionHeading>
 */
import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export function SectionHeading({
  children,
  count,
  action,
  icon: Icon,
  className,
}: {
  /** Nhãn mục (vd "Tổng quan"). */
  children: React.ReactNode;
  /** Số đếm hiển thị dạng chip — bỏ qua nếu null/undefined. */
  count?: number | string | null;
  /** Element bên phải (nút "Xem tất cả", filter…). */
  action?: React.ReactNode;
  /** Icon lucide trước nhãn (optional) — cho heading có biểu tượng. */
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-center gap-3', className)}>
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
        {Icon && (
          <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={2} aria-hidden />
        )}
        {children}
      </h2>
      {count !== null && count !== undefined && count !== '' && (
        <span className="rounded-full border border-divider bg-muted/50 px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      <span
        aria-hidden
        className="h-px flex-1 bg-gradient-to-r from-border to-transparent"
      />
      {action}
    </div>
  );
}
