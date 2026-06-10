/**
 * EmptyState — placeholder UI khi list rỗng (chưa có document/flashcard/...).
 *
 * Unify 5+ pattern empty cũ trong codebase:
 *   - Card border-dashed + title + description
 *   - div text-center muted
 *   - Card với icon + CTA button
 * Tất cả đều rút về `<EmptyState icon={X} title="" description="" action={...} />`.
 *
 * Variant:
 *   - 'dashed' (default): bordered dashed card — hợp cho main content area.
 *   - 'card'           : solid card border — fit trong list/grid.
 *   - 'inline'         : no border, ít padding — cho sidebar/popover.
 *
 * Truyền `icon` từ lucide-react (vd `FileText`); component sẽ tự render trong
 * tròn xám bo góc. Bỏ `icon` nếu không cần.
 */
import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'dashed' | 'card' | 'inline';

// Cogniva design: rounded-2xl, surface-secondary cho dashed, layered card.
const variantMap: Record<Variant, string> = {
  dashed: 'rounded-2xl border border-dashed border-border bg-surface-secondary/40 px-6 py-14',
  card: 'rounded-2xl border border-divider bg-card shadow-soft px-6 py-12',
  inline: 'px-4 py-6',
};

type Props = {
  /** Icon hiển thị trên cùng. Optional. */
  icon?: LucideIcon;
  /** Tiêu đề chính của empty state. */
  title: React.ReactNode;
  /** Description ngắn dưới title — giải thích state + cách khắc phục. */
  description?: React.ReactNode;
  /** CTA element (button, link) — đặt dưới description. */
  action?: React.ReactNode;
  /** Variant render. Default 'dashed'. */
  variant?: Variant;
  /** className thêm vào root container. */
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'dashed',
  className,
}: Props) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center overflow-hidden text-center',
        variantMap[variant],
        className,
      )}
    >
      {/* Subtle accent glow ở giữa cho dashed/card variant — identity dot
          chứ không phải card phẳng. inline variant skip. */}
      {variant !== 'inline' && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-12 left-1/2 h-32 w-32 -translate-x-1/2 rounded-full bg-primary/10 blur-2xl"
        />
      )}

      <div className="relative">
        {Icon && (
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary shadow-soft ring-1 ring-inset ring-primary/20">
            <Icon className="h-6 w-6" aria-hidden="true" strokeWidth={1.75} />
          </div>
        )}
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        {description && (
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}
