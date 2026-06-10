/**
 * MindMapView — V5 recipe "Mind map" embed graph viz.
 *
 * V5.3: scope workspace. V6.6: user có thể toggle scope:
 *   - "Workspace này" (default): /api/graph?workspaceId=X
 *   - "Tất cả workspaces" (cross-workspace): /api/graph (no scope)
 *
 * Spec: docs/plans/v5-notebooklm-layout.md §5.3 + V6.6.
 */
'use client';

import * as React from 'react';
import { Network } from 'lucide-react';

import { GraphView } from '@/components/graph/graph-view';
import { cn } from '@/lib/utils';

type Scope = 'workspace' | 'all';

export function MindMapView({ workspaceId }: { workspaceId: string }) {
  const [scope, setScope] = React.useState<Scope>('workspace');

  // V8.25: header bỏ "Quay lại chat" — modal có X riêng. Chừa pr-14 cho X.
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b bg-muted/20 px-4 py-2 pr-14">
        <div className="flex items-center justify-end gap-2">
          <div className="flex items-center gap-2">
            {/* V6.6: scope toggle — workspace này vs cross-workspace */}
            <div className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5 text-[11px]">
              <button
                onClick={() => setScope('workspace')}
                className={cn(
                  'rounded px-2 py-1 transition-colors',
                  scope === 'workspace'
                    ? 'bg-primary/10 font-semibold text-primary'
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
                    ? 'bg-primary/10 font-semibold text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                title="Tất cả atom của user — cross-workspace"
              >
                Tất cả workspaces
              </button>
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Network className="h-3 w-3 text-primary" />
              Mind map
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        {/* Remount GraphView khi scope đổi — cache layout key by hash sẽ
            tự re-layout với nodes mới. */}
        <GraphView
          key={scope}
          workspaceId={scope === 'workspace' ? workspaceId : undefined}
        />
      </div>
    </div>
  );
}
