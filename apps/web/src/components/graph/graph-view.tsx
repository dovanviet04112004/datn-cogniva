'use client';

import * as React from 'react';
import dagre from 'dagre';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import { FileUp, Loader2, Network, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import '@xyflow/react/dist/style.css';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

import { ConceptNode, type ConceptNodeData } from './concept-node';
import { ConceptPanel } from './concept-panel';
import { GraphToolbar } from './graph-toolbar';

const NODE_TYPES = { concept: ConceptNode, domainLabel: DomainLabelNode };

const NODE_WIDTH = 200;
const NODE_HEIGHT = 70;
const GRID_GAP_X = 220;
const GRID_GAP_Y = 96;
const DOMAIN_HEADER_HEIGHT = 32;
const DOMAIN_BLOCK_GAP = 64;

const DOMAIN_LABELS: Record<string, string> = {
  math: 'Toán',
  cs: 'Khoa học máy tính',
  physics: 'Vật lý',
  chemistry: 'Hóa học',
  biology: 'Sinh học',
  history: 'Lịch sử',
  language: 'Ngôn ngữ',
  business: 'Kinh doanh',
  general: 'Khác',
  unknown: 'Chưa phân loại',
};

function DomainLabelNode({ data }: { data: { label: string; count: number } }) {
  return (
    <div className="pointer-events-none select-none">
      <div className="text-muted-foreground flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
        <span>{data.label}</span>
        <span className="text-muted-foreground/60 text-[10px] font-normal">· {data.count}</span>
      </div>
    </div>
  );
}

function layoutGraph(
  nodes: Node<ConceptNodeData>[],
  edges: Edge[],
): { nodes: Node[]; labels: Node[] } {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const queue = [n.id];
    const comp: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      comp.push(id);
      for (const next of adj.get(id) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    }
    components.push(comp);
  }

  const connected = components.filter((c) => c.length >= 2);
  const orphans = components.filter((c) => c.length === 1).flat();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const positions = new Map<string, { x: number; y: number }>();
  const labelNodes: Node[] = [];

  type LaidComp = {
    ids: string[];
    width: number;
    height: number;
    xs: Map<string, { x: number; y: number }>;
  };
  const laid: LaidComp[] = [];
  for (const comp of connected) {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 90 });
    const set = new Set(comp);
    comp.forEach((id) => g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
    for (const e of edges) {
      if (set.has(e.source) && set.has(e.target)) g.setEdge(e.source, e.target);
    }
    dagre.layout(g);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const xs = new Map<string, { x: number; y: number }>();
    for (const id of comp) {
      const p = g.node(id);
      xs.set(id, { x: p.x, y: p.y });
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const normalized = new Map<string, { x: number; y: number }>();
    for (const [id, p] of xs) normalized.set(id, { x: p.x - minX, y: p.y - minY });
    laid.push({
      ids: comp,
      width: maxX - minX,
      height: maxY - minY,
      xs: normalized,
    });
  }

  const totalConnectedWidth =
    laid.reduce((s, c) => s + c.width, 0) + Math.max(0, laid.length - 1) * GRID_GAP_X;
  let cx = -totalConnectedWidth / 2;
  let maxConnectedY = 0;
  for (const c of laid) {
    for (const [id, p] of c.xs) {
      positions.set(id, { x: cx + p.x, y: p.y });
    }
    maxConnectedY = Math.max(maxConnectedY, c.height);
    cx += c.width + GRID_GAP_X;
  }

  const byDomain = new Map<string, string[]>();
  for (const id of orphans) {
    const node = nodeById.get(id);
    const domain = node?.data.domain ?? 'unknown';
    const list = byDomain.get(domain) ?? [];
    list.push(id);
    byDomain.set(domain, list);
  }

  const domainEntries = Array.from(byDomain.entries()).sort((a, b) => b[1].length - a[1].length);

  const orphanStartY = laid.length > 0 ? maxConnectedY + DOMAIN_BLOCK_GAP * 2 : 0;

  let yCursor = orphanStartY;
  for (const [domainKey, ids] of domainEntries) {
    const cols = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(ids.length * 1.5))));
    const rows = Math.ceil(ids.length / cols);
    const rowWidth = (cols - 1) * GRID_GAP_X;
    const startX = -rowWidth / 2;

    labelNodes.push({
      id: `label-${domainKey}`,
      type: 'domainLabel',
      position: {
        x: startX - NODE_WIDTH / 2,
        y: yCursor - DOMAIN_HEADER_HEIGHT,
      },
      data: { label: DOMAIN_LABELS[domainKey] ?? domainKey, count: ids.length },
      draggable: false,
      selectable: false,
      zIndex: 0,
    });

    ids.forEach((id, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const isLastRow = row === rows - 1;
      const itemsInRow = isLastRow ? ids.length - row * cols : cols;
      const lastRowWidth = (itemsInRow - 1) * GRID_GAP_X;
      const rowStartX = isLastRow ? -lastRowWidth / 2 : startX;
      positions.set(id, {
        x: rowStartX + col * GRID_GAP_X,
        y: yCursor + row * GRID_GAP_Y,
      });
    });
    yCursor += rows * GRID_GAP_Y + DOMAIN_BLOCK_GAP;
  }

  const laidNodes = nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });

  return { nodes: laidNodes, labels: labelNodes };
}

type GraphResponse = {
  nodes: Node<ConceptNodeData>[];
  edges: Edge[];
};

function hashGraph(nodes: Node<ConceptNodeData>[], edges: Edge[]): string {
  const sig = [
    ...nodes.map((n) => n.id).sort(),
    '|',
    ...edges.map((e) => `${e.source}>${e.target}`).sort(),
  ].join(',');
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h * 33) ^ sig.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const LAYOUT_CACHE_KEY = 'cogniva.graph.layout.v1';

type CachedLayout = {
  hash: string;
  positions: Record<string, { x: number; y: number }>;
  labels: Node[];
};

function readLayoutCache(): CachedLayout | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(LAYOUT_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedLayout;
  } catch {
    return null;
  }
}

function writeLayoutCache(payload: CachedLayout): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

function applyCachedPositions(
  nodes: Node<ConceptNodeData>[],
  positions: Record<string, { x: number; y: number }>,
): Node[] {
  return nodes.map((n) => ({
    ...n,
    position: positions[n.id] ?? { x: 0, y: 0 },
  }));
}

function GraphCanvas({ workspaceId }: { workspaceId?: string }) {
  const [rawConceptNodes, setRawConceptNodes] = React.useState<Node[]>([]);
  const [labelNodes, setLabelNodes] = React.useState<Node[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const [searchQuery, setSearchQuery] = React.useState('');
  const [activeDomain, setActiveDomain] = React.useState<string | null>(null);

  const { fitView } = useReactFlow();

  const {
    data: graphData,
    isLoading: loading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: qk.graph(workspaceId),
    queryFn: () =>
      apiGet<GraphResponse>(`/api/graph${workspaceId ? `?workspaceId=${workspaceId}` : ''}`),
  });
  const error = queryError ? (queryError as Error).message : null;

  React.useEffect(() => {
    if (!graphData) return;
    const hash = hashGraph(graphData.nodes, graphData.edges);
    const cached = readLayoutCache();
    if (cached && cached.hash === hash) {
      setRawConceptNodes(applyCachedPositions(graphData.nodes, cached.positions));
      setLabelNodes(cached.labels);
    } else {
      const { nodes: laidOut, labels } = layoutGraph(graphData.nodes, graphData.edges);
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of laidOut) positions[n.id] = n.position;
      writeLayoutCache({ hash, positions, labels });
      setRawConceptNodes(laidOut);
      setLabelNodes(labels);
    }
    setEdges(graphData.edges);
  }, [graphData]);

  React.useEffect(() => {
    if (rawConceptNodes.length === 0) return;
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [rawConceptNodes, fitView]);

  const domainCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const n of rawConceptNodes) {
      const d = (n.data as ConceptNodeData).domain ?? 'unknown';
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count);
  }, [rawConceptNodes]);

  const neighborMap = React.useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [edges]);

  const displayedNodes = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const decorated: Node[] = rawConceptNodes.map((n) => {
      const data = n.data as ConceptNodeData;
      let matches = true;
      if (selectedId) {
        matches = n.id === selectedId || (neighborMap.get(selectedId)?.has(n.id) ?? false);
      } else {
        if (q) matches = matches && data.name.toLowerCase().includes(q);
        if (activeDomain) matches = matches && data.domain === activeDomain;
      }
      const isNeighbor =
        !!selectedId && n.id !== selectedId && neighborMap.get(selectedId)?.has(n.id);
      return {
        ...n,
        data: { ...data, dim: !matches, neighbor: isNeighbor || undefined },
      };
    });
    const decoratedLabels: Node[] = labelNodes.map((l) => {
      const key = l.id.replace(/^label-/, '');
      const dim = activeDomain !== null && key !== activeDomain;
      return { ...l, style: { ...(l.style ?? {}), opacity: dim ? 0.25 : 1 } };
    });
    return [...decoratedLabels, ...decorated];
  }, [rawConceptNodes, labelNodes, searchQuery, activeDomain, selectedId, neighborMap]);

  const displayedEdges = React.useMemo(() => {
    const dimSet = new Set(
      (displayedNodes.filter((n) => (n.data as ConceptNodeData)?.dim) ?? []).map((n) => n.id),
    );
    return edges.map((e) => {
      const dim = dimSet.has(e.source) || dimSet.has(e.target);
      const isSelectedEdge = selectedId && (e.source === selectedId || e.target === selectedId);
      return {
        ...e,
        style: {
          ...(e.style ?? {}),
          stroke: isSelectedEdge ? '#6366f1' : '#64748b',
          strokeWidth: isSelectedEdge ? 2.5 : 1.5,
          opacity: dim ? 0.15 : 1,
        },
        animated: !!isSelectedEdge,
      };
    });
  }, [edges, displayedNodes, selectedId]);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    if (node.type === 'domainLabel') return;
    setSelectedId((prev) => (prev === node.id ? null : node.id));
  };

  const onPaneClick = () => setSelectedId(null);

  if (loading) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Đang dựng bản đồ kiến thức...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-destructive text-sm font-medium">Lỗi tải graph: {error}</p>
        <Button onClick={() => void refetch()} size="sm" variant="outline">
          Thử lại
        </Button>
      </div>
    );
  }

  if (rawConceptNodes.length === 0) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-4 overflow-hidden px-6 text-center">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-50/40 via-transparent to-purple-50/40 dark:from-indigo-950/30 dark:to-purple-950/30" />
        <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg">
          <Network className="h-8 w-8" />
        </div>
        <div className="relative z-10 max-w-md space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">Bản đồ kiến thức còn trống</h2>
          <p className="text-muted-foreground text-sm">
            Upload tài liệu PDF/text để AI tự động trích xuất khái niệm và dựng bản đồ quan hệ giữa
            chúng. Sau khi extract xong, bấm{' '}
            <span className="text-foreground font-medium">Tìm liên kết</span> để AI mine
            prerequisite edges.
          </p>
        </div>
        <Button asChild size="lg" className="relative z-10">
          <Link href="/documents">
            <FileUp className="mr-2 h-4 w-4" />
            Upload tài liệu
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <GraphToolbar
        domainCounts={domainCounts}
        activeDomain={activeDomain}
        onDomainChange={setActiveDomain}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        totalConcepts={rawConceptNodes.length}
        totalEdges={edges.length}
        onMined={() => {
          try {
            sessionStorage.removeItem(LAYOUT_CACHE_KEY);
          } catch {}
          void refetch();
        }}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex-1">
          <ReactFlow
            nodes={displayedNodes}
            edges={displayedEdges}
            nodeTypes={NODE_TYPES}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(n) => {
                if (n.type === 'domainLabel') return 'transparent';
                const d = (n.data as ConceptNodeData).domain;
                return (
                  {
                    math: '#3b82f6',
                    cs: '#a855f7',
                    physics: '#f97316',
                    chemistry: '#ec4899',
                    biology: '#22c55e',
                    history: '#f59e0b',
                    language: '#f43f5e',
                    business: '#10b981',
                  }[d] ?? '#64748b'
                );
              }}
              nodeStrokeWidth={2}
              maskColor="rgb(15 23 42 / 0.05)"
              pannable
              zoomable
            />
          </ReactFlow>
        </div>
        <ConceptPanel conceptId={selectedId} onClose={() => setSelectedId(null)} />
      </div>
    </div>
  );
}

export function GraphView({ workspaceId }: { workspaceId?: string } = {}) {
  return (
    <ReactFlowProvider>
      <GraphCanvas workspaceId={workspaceId} />
    </ReactFlowProvider>
  );
}
