'use client';

import * as React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';
import { DOMAIN_CARD } from '@/lib/graph/domains';

export type ConceptNodeData = {
  name: string;
  description: string | null;
  domain: string;
  mastery: number | undefined;
  dim?: boolean;
  neighbor?: boolean;
  enterDelay?: number;
};

function masteryRing(mastery: number | undefined): string {
  if (mastery === undefined) return 'ring-1 ring-slate-700/40';
  if (mastery >= 0.7) return 'ring-2 ring-green-400/80';
  if (mastery >= 0.3) return 'ring-2 ring-yellow-400/80';
  return 'ring-2 ring-red-400/80';
}

function ConceptNodeImpl({ data, selected }: NodeProps) {
  const d = data as unknown as ConceptNodeData;
  const domainStyle = DOMAIN_CARD[d.domain] ?? DOMAIN_CARD.general;

  return (
    <div
      style={d.enterDelay !== undefined ? { animationDelay: `${d.enterDelay}ms` } : undefined}
      className={cn(
        'group/node relative rounded-xl border px-3.5 py-2.5 backdrop-blur-md',
        'text-foreground min-w-[148px] max-w-[210px] cursor-pointer',
        'bg-surface/70 shadow-soft',
        'animate-graph-node-in',
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
