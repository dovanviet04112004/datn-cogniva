'use client';

import * as React from 'react';
import { Network } from 'lucide-react';

import { GraphView } from '@/components/graph/graph-view';
import { cn } from '@/lib/utils';

type Scope = 'workspace' | 'all';

export function MindMapView({ workspaceId }: { workspaceId: string }) {
  const [scope, setScope] = React.useState<Scope>('workspace');

  return (
    <div className="flex h-full flex-col">
      <header className="bg-muted/20 shrink-0 border-b px-4 py-2 pr-14">
        <div className="flex items-center justify-end gap-2">
          <div className="flex items-center gap-2">
            <div className="bg-card inline-flex items-center gap-0.5 rounded-md border p-0.5 text-[11px]">
              <button
                onClick={() => setScope('workspace')}
                className={cn(
                  'rounded px-2 py-1 transition-colors',
                  scope === 'workspace'
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                title="Chỉ atom của workspace này"
              >
                Workspace này
              </button>
              <button
                onClick={() => setScope('all')}
                className={cn(
                  'rounded px-2 py-1 transition-colors',
                  scope === 'all'
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                title="Tất cả atom của user — cross-workspace"
              >
                Tất cả workspaces
              </button>
            </div>
            <div className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              <Network className="text-primary h-3 w-3" />
              Mind map
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <GraphView key={scope} workspaceId={scope === 'workspace' ? workspaceId : undefined} />
      </div>
    </div>
  );
}
