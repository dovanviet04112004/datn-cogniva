'use client';

import * as React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';

export type ConceptNodeData = {
  name: string;
  description: string | null;
  domain: string;
  mastery: number | undefined;
  dim?: boolean;
  neighbor?: boolean;
};

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
        'group/node relative rounded-xl border px-3.5 py-2.5 backdrop-blur-md',
        'text-foreground min-w-[148px] max-w-[210px] cursor-pointer',
        'bg-surface/70 shadow-soft',
        'duration-base ease-expo-out transition-all',
        'hover:shadow-elevated hover:-translate-y-0.5',
        domainStyle,
        masteryRing(d.mastery),
        selected && 'shadow-glow ring-offset-background ring-offset-2',
        d.dim && 'opacity-25 saturate-50',
        d.neighbor && 'ring-primary/60 ring-offset-background ring-2 ring-offset-1',
      )}
    >
      <div
        aria-hidden
        className={cn(
          'bg-primary/10 duration-base pointer-events-none absolute -inset-1 rounded-xl opacity-0 blur-md transition-opacity',
          'group-hover/node:opacity-100',
          selected && 'opacity-60',
        )}
      />

      <Handle type="target" position={Position.Top} className="!border-0 !bg-transparent" />

      <div className="relative space-y-0.5">
        <div className="text-foreground text-sm font-semibold leading-tight tracking-tight">
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
          <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-[0.14em]">
            {d.domain}
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!border-0 !bg-transparent" />
    </div>
  );
}

export const ConceptNode = React.memo(ConceptNodeImpl);
