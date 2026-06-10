/**
 * ConceptNode — custom React Flow node cho concept.
 *
 * Visual:
 *   - Border + bg theo domain (math=blue, cs=purple, biology=green, …)
 *   - Mastery overlay: ring color theo BKT score (Phase 6 sẽ wire data thật;
 *     Phase 4 stub gray).
 *   - Click → page parent gọi onClick(id) qua React Flow `onNodeClick`.
 *
 * Phải dùng React.memo (qua Handle) — React Flow re-render nodes nhiều lần
 * khi viewport thay đổi.
 */
'use client';

import * as React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';

export type ConceptNodeData = {
  name: string;
  description: string | null;
  domain: string;
  /** Mastery 0..1 — undefined cho concept chưa được luyện (mặc định Phase 4). */
  mastery: number | undefined;
  /**
   * Render mờ + grayscale khi search/filter/select không match. Tính ở
   * GraphCanvas qua useMemo theo searchQuery / activeDomain / selectedId.
   */
  dim?: boolean;
  /** Highlight ring đặc biệt khi node là neighbor trực tiếp của selectedId. */
  neighbor?: boolean;
};

/**
 * Map domain → tailwind class cho border/bg. Text dùng `text-foreground` để
 * theme-aware (đen trên light, trắng trên dark) — KHÔNG hardcode text-xxx-100
 * vì sẽ vô hình trên light mode.
 */
const DOMAIN_STYLES: Record<string, string> = {
  math: 'border-blue-500/60 bg-blue-500/15',
  cs: 'border-purple-500/60 bg-purple-500/15',
  physics: 'border-orange-500/60 bg-orange-500/15',
  chemistry: 'border-pink-500/60 bg-pink-500/15',
  biology: 'border-green-500/60 bg-green-500/15',
  history: 'border-amber-500/60 bg-amber-500/15',
  language: 'border-rose-500/60 bg-rose-500/15',
  business: 'border-emerald-500/60 bg-emerald-500/15',
  general: 'border-slate-500/60 bg-slate-500/15',
};

/** Mastery → ring color (cao = xanh, thấp = đỏ, undefined = mờ). */
function masteryRing(mastery: number | undefined): string {
  if (mastery === undefined) return 'ring-1 ring-slate-700/40';
  if (mastery >= 0.7) return 'ring-2 ring-green-400/80';
  if (mastery >= 0.3) return 'ring-2 ring-yellow-400/80';
  return 'ring-2 ring-red-400/80';
}

function ConceptNodeImpl({ data, selected }: NodeProps) {
  const d = data as unknown as ConceptNodeData;
  const domainStyle = DOMAIN_STYLES[d.domain] ?? DOMAIN_STYLES.general;

  return (
    <div
      className={cn(
        // Geometry — rounded-xl premium, soft border thay vì border-2 cứng
        'group/node relative rounded-xl border px-3.5 py-2.5 backdrop-blur-md',
        'min-w-[148px] max-w-[210px] cursor-pointer text-foreground',
        // Layered surface (subtle bg + border domain-tinted)
        'bg-surface/70 shadow-soft',
        // Motion: lift + glow on hover
        'transition-all duration-base ease-expo-out',
        'hover:-translate-y-0.5 hover:shadow-elevated',
        domainStyle,
        masteryRing(d.mastery),
        selected && 'shadow-glow ring-offset-2 ring-offset-background',
        // Dim/neighbor highlight states — controlled bởi GraphCanvas
        d.dim && 'opacity-25 saturate-50',
        d.neighbor && 'ring-2 ring-primary/60 ring-offset-1 ring-offset-background',
      )}
    >
      {/* Ambient glow halo — chỉ hover/selected mới hiện, blur-md primary */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -inset-1 rounded-xl bg-primary/10 opacity-0 blur-md transition-opacity duration-base',
          'group-hover/node:opacity-100',
          selected && 'opacity-60',
        )}
      />

      {/* Handles ẩn — chỉ làm anchor cho edges, không hiện chấm */}
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />

      <div className="relative space-y-0.5">
        <div className="text-sm font-semibold leading-tight tracking-tight text-foreground">
          {d.name}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'h-1 w-1 rounded-full',
              d.mastery !== undefined && d.mastery >= 0.7 && 'bg-green-500',
              d.mastery !== undefined && d.mastery >= 0.3 && d.mastery < 0.7 && 'bg-yellow-500',
              d.mastery !== undefined && d.mastery < 0.3 && 'bg-red-500',
              d.mastery === undefined && 'bg-muted-foreground/40',
            )}
          />
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {d.domain}
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  );
}

export const ConceptNode = React.memo(ConceptNodeImpl);
