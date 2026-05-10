/**
 * /graph — Knowledge Graph viewer.
 *
 * Server-side: chỉ check session (middleware đã chặn unauth, nhưng đây để
 * SEO + redirect rõ ràng nếu middleware bypass).
 * Client: GraphView fetch /api/graph + render React Flow.
 *
 * Layout full-bleed (không padding card) — graph cần dùng trọn không gian
 * còn lại sau sidebar/topbar.
 */
import { GraphView } from '@/components/graph/graph-view';

export const metadata = {
  title: 'Knowledge Graph · Cogniva',
};

export default function GraphPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <h1 className="text-xl font-semibold">Knowledge Graph</h1>
        <p className="text-sm text-muted-foreground">
          Bản đồ khái niệm tự động trích xuất từ tài liệu của bạn — click 1 node để xem chunks
          liên quan.
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <GraphView />
      </div>
    </div>
  );
}
