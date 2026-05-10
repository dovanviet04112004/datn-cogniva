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

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;

/**
 * Layout nodes theo Dagre (top-bottom directed graph).
 * Mutate position của node — return cùng reference để React Flow re-render.
 */
function layoutGraph(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 100 });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
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
