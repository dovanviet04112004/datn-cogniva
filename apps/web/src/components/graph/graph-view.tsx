/**
 * GraphView — client component render React Flow knowledge graph.
 *
 * Luồng:
 *   1. Fetch /api/graph khi mount
 *   2. Auto-layout bằng Dagre (left-right hierarchy) vì server không tính
 *      position
 *   3. Render React Flow với:
 *      - ConceptNode tùy chỉnh (theo domain + mastery)
 *      - Edge default + label relationType
 *      - Controls (zoom/fit), MiniMap, Background dotted
 *   4. onNodeClick → set selectedConceptId → ConceptPanel mở
 *
 * Vì sao Dagre (không Cytoscape, không ELK)?
 *   - Dagre nhỏ gọn (15kb), API đơn giản, đủ cho directed acyclic graph.
 *   - ELK tốt hơn cho graph cực lớn nhưng setup phức tạp + WASM.
 *
 * Phase 5: cache layout vào session storage để không re-layout mỗi lần mount.
 */
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
/** Khoảng cách phía trên header label tới hàng node đầu tiên trong domain. */
const DOMAIN_HEADER_HEIGHT = 32;
/** Khoảng cách giữa 2 domain group liên tiếp. */
const DOMAIN_BLOCK_GAP = 64;

/** Friendly label cho domain. */
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

/**
 * Header label nhỏ phía trên 1 domain group orphan — không có handle, không
 * clickable, chỉ là text annotation trong React Flow canvas.
 */
function DomainLabelNode({ data }: { data: { label: string; count: number } }) {
  return (
    <div className="pointer-events-none select-none">
      <div className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span>{data.label}</span>
        {/* Count phụ — sàn 10px (chuẩn DS: không nhỏ hơn 10px) để không lệch tông eyebrow. */}
        <span className="text-[10px] font-normal text-muted-foreground/60">
          · {data.count}
        </span>
      </div>
    </div>
  );
}

/**
 * Layout hybrid:
 *   1. BFS tìm connected components qua edges.
 *   2. Component nào có ≥ 2 node + ≥ 1 edge → Dagre TB hierarchy.
 *   3. Component đơn lẻ (orphan node) → gom theo domain, xếp grid bên dưới
 *      + thêm 1 label node phía trên mỗi domain group.
 *
 * Center ngang theo x=0 — connected row và orphan grid đều cân đối qua trục
 * gốc → khi `fitView` chạy, bounding box symmetric → không lệch trái/phải.
 *
 * Vì sao không thuần Dagre? Dagre đặt mọi orphan node cùng rank 0 → tất
 * cả thành 1 hàng ngang dài 5000px khó nhìn.
 */
function layoutGraph(
  nodes: Node<ConceptNodeData>[],
  edges: Edge[],
): { nodes: Node[]; labels: Node[] } {
  // ── 1. Build adjacency cho BFS ─────────────────────
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  // ── 2. BFS tìm components ──────────────────────────
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

  // ── 3. Tách connected (≥ 2 node) vs orphan ─────────
  const connected = components.filter((c) => c.length >= 2);
  const orphans = components.filter((c) => c.length === 1).flat();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const positions = new Map<string, { x: number; y: number }>();
  const labelNodes: Node[] = [];

  // ── 4. Layout connected components qua Dagre TB ───
  // Mỗi component layout riêng → đặt thành hàng ngang centered ở x=0.
  // Đầu tiên tính chiều rộng từng comp + tổng để center.
  type LaidComp = { ids: string[]; width: number; height: number; xs: Map<string, { x: number; y: number }> };
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
    // Normalize tọa độ về (0, 0) origin
    const normalized = new Map<string, { x: number; y: number }>();
    for (const [id, p] of xs) normalized.set(id, { x: p.x - minX, y: p.y - minY });
    laid.push({
      ids: comp,
      width: maxX - minX,
      height: maxY - minY,
      xs: normalized,
    });
  }

  // Tính tổng width connected để center hàng quanh x=0
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

  // ── 5. Layout orphan nodes — group theo domain, mỗi group grid centered ──
  const byDomain = new Map<string, string[]>();
  for (const id of orphans) {
    const node = nodeById.get(id);
    const domain = node?.data.domain ?? 'unknown';
    const list = byDomain.get(domain) ?? [];
    list.push(id);
    byDomain.set(domain, list);
  }

  // Sort domain để layout ổn định + domain nhiều node lên trước (visual nặng).
  const domainEntries = Array.from(byDomain.entries()).sort((a, b) => b[1].length - a[1].length);

  // Y bắt đầu của orphan section — dưới connected (nếu có) một khoảng.
  const orphanStartY =
    laid.length > 0 ? maxConnectedY + DOMAIN_BLOCK_GAP * 2 : 0;

  let yCursor = orphanStartY;
  for (const [domainKey, ids] of domainEntries) {
    // Cột: sqrt-based, tối thiểu 4, tối đa 8 — cân đối visual cho mọi cỡ.
    const cols = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(ids.length * 1.5))));
    const rows = Math.ceil(ids.length / cols);
    // Width thực tế = (cols-1) * gap (vì node anchored center) → center quanh 0
    const rowWidth = (cols - 1) * GRID_GAP_X;
    const startX = -rowWidth / 2;

    // Label node phía trên hàng đầu — anchor top-left, đặt ở minX của hàng đầu
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
      // Không có handle nên zIndex thấp + không phá layout
      zIndex: 0,
    });

    ids.forEach((id, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      // Hàng cuối có thể thiếu node → center hàng cuối riêng
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

  // ── 6. Apply positions vào nodes ──────────────────
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

/**
 * Hash đơn giản (djb2 xor) trên sorted node + edge signatures. Stable
 * deterministic key cho sessionStorage cache — nếu user thêm/xóa concept
 * hoặc mine thêm edges, hash đổi → cache invalidate tự động.
 */
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
  } catch {
    /* quota / disabled — silent skip */
  }
}

/** Áp dụng cached positions vào nodes (nếu cache hit). */
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
  // Raw data (positions đã layout xong, KHÔNG bao gồm dim/neighbor decoration)
  const [rawConceptNodes, setRawConceptNodes] = React.useState<Node[]>([]);
  const [labelNodes, setLabelNodes] = React.useState<Node[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Toolbar state
  const [searchQuery, setSearchQuery] = React.useState('');
  const [activeDomain, setActiveDomain] = React.useState<string | null>(null);

  const { fitView } = useReactFlow();

  // React Query: fetch + cache + revalidate dữ liệu graph thô (chưa layout).
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

  // Layout (Dagre) chạy khi data đổi — cache positions vào sessionStorage theo hash
  // để KHÔNG re-layout mỗi lần (cache hit = bỏ qua dagre). Layout là cache tính
  // toán, tách khỏi React Query (chỉ cache dữ liệu thô).
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

  // Refit camera sau khi loadGraph xong (cache hit không trigger fitView prop)
  React.useEffect(() => {
    if (rawConceptNodes.length === 0) return;
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [rawConceptNodes, fitView]);

  // ── Domain counts cho toolbar ────────────────────────────
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

  // ── Neighbor map: id → Set<neighborId> ──────────────────
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

  // ── Derived: nodes có decoration dim/neighbor + filter ──
  const displayedNodes = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const decorated: Node[] = rawConceptNodes.map((n) => {
      const data = n.data as ConceptNodeData;
      // Match logic:
      //   - Có select → match nếu là selected hoặc neighbor
      //   - Có search → match nếu name chứa query
      //   - Có domain filter → match nếu cùng domain
      //   - Không filter → match tất cả
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
    // Labels: dim nếu domain không phải activeDomain (khi filter active)
    const decoratedLabels: Node[] = labelNodes.map((l) => {
      const key = l.id.replace(/^label-/, '');
      const dim = activeDomain !== null && key !== activeDomain;
      return { ...l, style: { ...(l.style ?? {}), opacity: dim ? 0.25 : 1 } };
    });
    return [...decoratedLabels, ...decorated];
  }, [rawConceptNodes, labelNodes, searchQuery, activeDomain, selectedId, neighborMap]);

  // ── Derived: edges với opacity giảm khi 2 endpoint không cùng match ──
  const displayedEdges = React.useMemo(() => {
    const dimSet = new Set(
      (displayedNodes.filter((n) => (n.data as ConceptNodeData)?.dim) ?? []).map((n) => n.id),
    );
    return edges.map((e) => {
      const dim = dimSet.has(e.source) || dimSet.has(e.target);
      const isSelectedEdge =
        selectedId && (e.source === selectedId || e.target === selectedId);
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

  // ── Render states ───────────────────────────────
  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Đang dựng bản đồ kiến thức...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-destructive">Lỗi tải graph: {error}</p>
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
          <p className="text-sm text-muted-foreground">
            Upload tài liệu PDF/text để AI tự động trích xuất khái niệm và dựng bản đồ
            quan hệ giữa chúng. Sau khi extract xong, bấm{' '}
            <span className="font-medium text-foreground">Tìm liên kết</span> để AI mine
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
          // Sau khi mine xong, invalidate cache (positions cũ vẫn dùng được
          // nhưng hash sẽ đổi vì có edges mới) rồi refetch.
          try {
            sessionStorage.removeItem(LAYOUT_CACHE_KEY);
          } catch {
            /* ignore */
          }
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

/** Wrapper cần cho React Flow Provider (phục vụ hooks ngoài Canvas). */
export function GraphView({ workspaceId }: { workspaceId?: string } = {}) {
  return (
    <ReactFlowProvider>
      <GraphCanvas workspaceId={workspaceId} />
    </ReactFlowProvider>
  );
}
