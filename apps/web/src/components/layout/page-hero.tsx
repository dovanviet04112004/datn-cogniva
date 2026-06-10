/**
 * PageHero — banner đầu trang PREMIUM dùng CHUNG cho các trang hub/landing
 * (dashboard, workspaces, library…).
 *
 * Đóng gói ngôn ngữ "spatial/glass depth" của dashboard thành 1 component để các
 * hub khác dùng chung → đồng bộ, không mỗi trang tự code hero 1 kiểu:
 *   - Aurora mesh nền + 2 glow halo brand (indigo + discovery)
 *   - Sheen line mảnh trên mép (premium edge)
 *   - Eyebrow pill kính + title to gradient-fade + description
 *   - Slot `children` bên phải (card/action tuỳ trang) + `decoration` (motif nền)
 *   - Entrance fade-in (tôn trọng prefers-reduced-motion qua guard globals)
 *
 * Presentational → dùng được Server lẫn Client Component.
 */
import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export function PageHero({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  description,
  children,
  decoration,
  className,
}: {
  /** Nhãn eyebrow uppercase trong pill kính (vd "AI Learning OS"). */
  eyebrow?: React.ReactNode;
  /** Icon lucide trước eyebrow. */
  eyebrowIcon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Slot bên phải (continue-card, action…). */
  children?: React.ReactNode;
  /** Motif nền tuỳ trang (vd NeuralPattern) — đặt absolute, mask phải. */
  decoration?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'animate-fade-in-up relative overflow-hidden rounded-2xl border border-divider bg-gradient-to-br from-card via-card to-surface-secondary px-7 py-8 shadow-elevated sm:px-9 sm:py-10',
        className,
      )}
    >
      {/* Aurora mesh — chiều sâu spatial */}
      <div aria-hidden className="bg-aurora pointer-events-none absolute inset-0" />
      {/* Sheen line trên cùng */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
      />
      {decoration}
      {/* Glow halo brand */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/18 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 left-1/4 h-48 w-48 rounded-full bg-discovery-500/12 blur-3xl"
      />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3.5">
          {eyebrow && (
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 shadow-soft backdrop-blur-sm">
              {EyebrowIcon && <EyebrowIcon className="h-3.5 w-3.5 text-primary" />}
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                {eyebrow}
              </span>
            </div>
          )}
          {/* Title SOLID (không gradient bg-clip-text) — vì nhiều trang truyền title
              kèm icon; bg-clip-text + text-transparent sẽ làm icon currentColor tàng
              hình. Solid bold trên nền aurora vẫn premium + an toàn mọi title. */}
          <h1 className="text-3xl font-bold leading-[1.05] tracking-tight sm:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {children && <div className="w-full shrink-0 sm:w-auto">{children}</div>}
      </div>
    </header>
  );
}
