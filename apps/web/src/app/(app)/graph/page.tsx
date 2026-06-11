import { GraphView } from '@/components/graph/graph-view';

export const metadata = {
  title: 'Knowledge Graph · Cogniva',
};

export default function GraphPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <h1 className="text-xl font-semibold">Knowledge Graph</h1>
        <p className="text-muted-foreground text-sm">
          Bản đồ khái niệm tự động trích xuất từ tài liệu của bạn — click 1 node để xem chunks liên
          quan.
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <GraphView />
      </div>
    </div>
  );
}
