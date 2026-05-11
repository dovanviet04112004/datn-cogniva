/**
 * SkeletonList — render N skeleton rows giả lập 1 list đang load.
 *
 * Dùng thay thế text "Đang tải..." để page có shape ngay (Cumulative Layout
 * Shift thấp hơn). Tham số `rows` quyết định số hàng giả.
 */
import { Skeleton } from './skeleton';
import { Card } from './card';

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-2/3" />
          </div>
          <Skeleton className="h-6 w-16" />
        </Card>
      ))}
    </div>
  );
}
