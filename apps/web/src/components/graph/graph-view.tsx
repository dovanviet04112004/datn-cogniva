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
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';

import { ConceptNode, type ConceptNodeData } from './concept-node';
import { ConceptPanel } from './concept-panel';

const NODE_TYPES = { concept: ConceptNode };

const NODE_WIDTH = 200;
const NODE_HEIGHT = 70;
const GRID_GAP_X = 240;
const GRID_GAP_Y = 110;

/**
 * Layout hybrid:
 *   1. BFS tìm connected components qua edges.
 *   2. Component nào có ≥ 2 node + ≥ 1 edge → Dagre TB hierarchy.
 *   3. Component đơn lẻ (orphan node) → gom theo domain, xếp grid bên dưới.
 *
 * Vì sao không thuần Dagre? Dagre đặt mọi orphan node cùng rank 0 → tất
 * cả thành 1 hàng ngang dài 5000px khó nhìn (graph hiện tại 28 node /
 * 8 edge → 20 orphan → grid sẽ gọn hơn nhiều).
 */
function layoutGraph(
  nodes: Node<ConceptNodeData>[],
  edges: Edge[],
): Node<ConceptNodeData>[] {
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

  // ── 4. Layout connected components qua Dagre TB ───
  // Mỗi component layout riêng rồi shift sang phải để không chồng.
  let xOffset = 0;
  let maxConnectedY = 0;
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

    // Tính bounding box của component để shift
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of comp) {
      const p = g.node(id);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const shift = xOffset - minX;
    for (const id of comp) {
      const p = g.node(id);
      positions.set(id, { x: p.x + shift, y: p.y });
    }
    xOffset += maxX - minX + GRID_GAP_X;
    maxConnectedY = Math.max(maxConnectedY, maxY);
  }

  // ── 5. Layout orphan nodes — group theo domain rồi grid ────
  const byDomain = new Map<string, string[]>();
  for (const id of orphans) {
    const node = nodeById.get(id);
    const domain = node?.data.domain ?? 'unknown';
    const list = byDomain.get(domain) ?? [];
    list.push(id);
    byDomain.set(domain, list);
  }

  const orphanTopY = maxConnectedY + GRID_GAP_Y * 2;
  let domainYOffset = orphanTopY;
  for (const [, ids] of byDomain) {
    // Mỗi domain 1 hàng (hoặc nhiều hàng nếu > 8 nodes)
    const cols = 6;
    ids.forEach((id, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      positions.set(id, {
        x: col * GRID_GAP_X,
        y: domainYOffset + row * GRID_GAP_Y,
      });
    });
    const rows = Math.ceil(ids.length / cols);
    domainYOffset += rows * GRID_GAP_Y + GRID_GAP_Y;
  }

  // ── 6. Apply positions vào nodes ──────────────────
  return nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });
}

type GraphResponse = {
  nodes: Node<ConceptNodeData>[];
  edges: Edge[];
};

function GraphCanvas() {
  const [nodes, setNodes] = React.useState<Node[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/graph')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((data: GraphResponse) => {
        const laidOut = layoutGraph(data.nodes, data.edges);
        setNodes(laidOut);
        setEdges(data.edges);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    setSelectedId(node.id);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Đang tải knowledge graph...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        Lỗi tải graph: {error}
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <p className="text-lg">Graph trống</p>
        <p className="max-w-md text-sm">
          Upload tài liệu rồi đợi concept extraction xong, hoặc chạy{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">pnpm extract:concepts</code> để
          backfill cho tài liệu cũ.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          fitView
          minZoom={0.2}
          maxZoom={2}
          // Edges nhẹ + animated nếu strength cao — visual hint
          defaultEdgeOptions={{ animated: false, style: { stroke: '#64748b', strokeWidth: 1.5 } }}
        >
          <Background gap={24} size={1} />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
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
            pannable
            zoomable
          />
        </ReactFlow>
      </div>
      <ConceptPanel conceptId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

/** Wrapper cần cho React Flow Provider (phục vụ hooks ngoài Canvas). */
export function GraphView() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  );
}
