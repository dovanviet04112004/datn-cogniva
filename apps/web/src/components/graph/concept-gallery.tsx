'use client';

import * as React from 'react';
import { Loader2, Network, Sparkles } from 'lucide-react';
import type { Node } from '@xyflow/react';

import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/utils';

import type { ConceptNodeData } from './concept-node';
import { DOMAIN_CARD, DOMAIN_DOT, DOMAIN_LABELS, masteryDotClass } from '@/lib/graph/domains';

type Props = {
  nodes: Node<ConceptNodeData>[];
  searchQuery: string;
  activeDomain: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  mining: boolean;
  onMine: () => void;
};

export function ConceptGallery({
  nodes,
  searchQuery,
  activeDomain,
  selectedId,
  onSelect,
  mining,
  onMine,
}: Props) {
  const groups = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const byDomain = new Map<string, Node<ConceptNodeData>[]>();
    for (const n of nodes) {
      const d = n.data.domain || 'unknown';
      if (activeDomain && d !== activeDomain) continue;
      if (q && !n.data.name.toLowerCase().includes(q)) continue;
      const list = byDomain.get(d) ?? [];
      list.push(n);
      byDomain.set(d, list);
    }
    return Array.from(byDomain.entries())
      .map(([domain, items]) => ({
        domain,
        items: items.sort((a, b) => a.data.name.localeCompare(b.data.name)),
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [nodes, searchQuery, activeDomain]);

  const matchCount = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="bg-surface-secondary/30 min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
        <div className="border-divider from-card via-card to-surface-secondary shadow-soft animate-fade-in-up relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 sm:p-6">
          <div
            aria-hidden
            className="bg-primary/10 pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full blur-3xl"
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <span className="from-primary/20 to-discovery-500/10 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br">
                <Network className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight">Bản đồ chưa có liên kết</h2>
                <p className="text-muted-foreground max-w-xl text-[13px] leading-relaxed">
                  {nodes.length} khái niệm đã trích từ tài liệu của bạn, hiện đang rời rạc. Để AI
                  phân tích quan hệ tiên quyết (khái niệm nào cần học trước) và nối chúng thành bản
                  đồ tương tác.
                </p>
              </div>
            </div>
            <Button
              size="lg"
              className="shrink-0 gap-2"
              disabled={mining || nodes.length < 2}
              onClick={onMine}
            >
              {mining ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {mining ? 'Đang nối...' : 'Nối khái niệm'}
            </Button>
          </div>
        </div>

        {matchCount === 0 ? (
          <div className="text-muted-foreground py-16 text-center text-sm">
            Không có khái niệm khớp bộ lọc.
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.domain}>
              <SectionHeading count={g.items.length}>
                {DOMAIN_LABELS[g.domain] ?? g.domain}
              </SectionHeading>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {g.items.map((n) => (
                  <ConceptCard
                    key={n.id}
                    data={n.data}
                    selected={selectedId === n.id}
                    onClick={() => onSelect(n.id)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function ConceptCard({
  data,
  selected,
  onClick,
}: {
  data: ConceptNodeData;
  selected: boolean;
  onClick: () => void;
}) {
  const accent = DOMAIN_CARD[data.domain] ?? DOMAIN_CARD.general;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-divider bg-card shadow-soft duration-base ease-expo-out group flex flex-col gap-2 rounded-xl border p-3 text-left transition-all',
        'hover:shadow-elevated hover:border-foreground/15 hover:-translate-y-0.5',
        selected && 'ring-primary/60 border-primary/40 ring-2',
      )}
    >
      <span className={cn('h-1 w-7 rounded-full border', accent)} />
      <span className="text-foreground line-clamp-2 text-[13px] font-semibold leading-snug tracking-tight">
        {data.name}
      </span>
      <span className="mt-auto flex items-center gap-1.5">
        <span
          className={cn('h-1.5 w-1.5 rounded-full', DOMAIN_DOT[data.domain] ?? 'bg-slate-500')}
        />
        <span className="text-text-muted text-[10px] font-medium uppercase tracking-[0.12em]">
          {DOMAIN_LABELS[data.domain] ?? data.domain}
        </span>
        <span className={cn('ml-auto h-1.5 w-1.5 rounded-full', masteryDotClass(data.mastery))} />
      </span>
    </button>
  );
}
