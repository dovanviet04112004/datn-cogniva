/**
 * StatCard — thẻ metric DÙNG CHUNG toàn app.
 *
 * Thay các bản StatTile/stat-card copy hardcode per-page. Glass card có depth +
 * hover lift + icon tint + quầng accent. Số dùng **sans tabular-nums đậm** (KHÔNG
 * font-mono — chữ số mono nhìn khô/cũ); tabular-nums vẫn canh cột thẳng.
 *
 * Presentational → dùng được cả Server lẫn Client Component.
 *
 * Usage:
 *   <StatCard icon={FileText} tint="bg-blue-500/10"
 *     tintText="text-blue-600 dark:text-blue-400"
 *     label="Tài liệu" value={n.toLocaleString('vi-VN')} hint="hôm nay" />
 */
import * as React from 'react';
import { type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export function StatCard({
  icon: Icon,
  tint,
  tintText,
  accent,
  label,
  value,
  hint,
  className,
}: {
  /** Icon (optional) — render trong badge gradient góc trái. */
  icon?: LucideIcon;
  /** Class nền tint cho badge + quầng accent khi KHÔNG truyền `accent`, vd 'bg-blue-500/10'. */
  tint?: string;
  /** Class màu icon, vd 'text-blue-600 dark:text-blue-400'. */
  tintText?: string;
  /**
   * Gradient accent (vd 'from-blue-500/25 to-blue-500/5') — badge icon + quầng +
   * thanh dưới dùng chung tông này, đồng ngôn ngữ với QuickAction. Fallback `tint`.
   */
  accent?: string;
  label: string;
  /** Giá trị (đã format sẵn, vd `n.toLocaleString('vi-VN')`). */
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  // Badge: gradient nếu có `accent`, ngược lại tint phẳng (tương thích call cũ).
  const badgeBg = accent ? cn('bg-gradient-to-br', accent) : tint;
  const haloBg = accent ? cn('bg-gradient-to-br', accent) : tint;
  return (
    <div
      className={cn(
        'group/stat relative overflow-hidden rounded-2xl border border-divider bg-card/70 p-4 shadow-soft backdrop-blur-sm transition-all duration-base ease-expo-out hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-elevated sm:p-5',
        className,
      )}
    >
      {/* Sheen line trên cùng — premium edge, hiện khi hover (đồng bộ QuickAction). */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent opacity-0 transition-opacity duration-base group-hover/stat:opacity-100"
      />
      {/* Quầng accent — sáng + nở khi hover. */}
      {haloBg && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-50 blur-2xl transition-all duration-base group-hover/stat:scale-110 group-hover/stat:opacity-90',
            haloBg,
          )}
        />
      )}
      <div className="relative flex items-center justify-between gap-2">
        {Icon && (
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-border/50 transition-transform duration-base group-hover/stat:scale-105',
              badgeBg,
              tintText,
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={2} />
          </span>
        )}
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
      </div>
      <div className="relative mt-3.5 flex items-baseline gap-1.5">
        <p className="text-3xl font-bold tabular-nums leading-none tracking-tight">
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {/* Thanh accent đáy — mảnh, grow từ trái khi hover (cảm giác data-viz tinh tế). */}
      {haloBg && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 opacity-70 transition-transform duration-slow ease-expo-out group-hover/stat:scale-x-100',
            haloBg,
          )}
        />
      )}
    </div>
  );
}
