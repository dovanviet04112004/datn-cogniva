/**
 * ChunkList — danh sách chunks panel phải trong trang /documents/[id].
 *
 * Tương tác:
 *   - Click 1 chunk có `meta.page` → cập nhật `window.location.hash` thành
 *     `#page-N` để PdfViewer (panel trái) scroll tới đúng trang.
 *   - Nếu hash hiện tại đã trùng (vd click cùng chunk 2 lần), gọi
 *     `scrollIntoView` thủ công vì hashchange event sẽ không fire.
 *   - Highlight chunk vừa click bằng ring primary để user thấy rõ context.
 *   - Chunk không có metadata.page (vd file txt) → render disabled (cursor
 *     default + tooltip lý do).
 *
 * Vì sao client component:
 *   - Cần onClick handler và state highlight → phải 'use client'.
 *   - Data chunks đã được server fetch sẵn ở [id]/page.tsx và truyền xuống
 *     dạng props → không cần fetch lại ở client.
 */
'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type ChunkItem = {
  id: string;
  content: string;
  tokens: number | null;
  metadata: { page?: number; chunkIndex?: number } | null;
};

type Props = {
  chunks: ChunkItem[];
};

/**
 * Jump tới trang PDF: cập nhật hash (PdfViewer listen hashchange).
 * Trường hợp hash đã trùng, scroll thủ công vì event không fire.
 */
function jumpToPage(page: number) {
  const target = `#page-${page}`;
  if (window.location.hash === target) {
    document.getElementById(`page-${page}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  } else {
    window.location.hash = target;
  }
}

export function ChunkList({ chunks }: Props) {
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);

  // Sync activeChunkId theo hash khi load lại (vd user reload với hash sẵn)
  useEffect(() => {
    const matchInitial = window.location.hash.match(/^#page-(\d+)$/);
    if (!matchInitial) return;
    const page = parseInt(matchInitial[1]!, 10);
    const first = chunks.find((c) => (c.metadata as { page?: number } | null)?.page === page);
    if (first) setActiveChunkId(first.id);
  }, [chunks]);

  if (chunks.length === 0) {
    return <p className="text-xs text-muted-foreground">Chưa có chunk nào.</p>;
  }

  return (
    <div className="space-y-3">
      {chunks.map((c, i) => {
        const meta = (c.metadata ?? {}) as { page?: number; chunkIndex?: number };
        const hasPage = typeof meta.page === 'number' && meta.page > 0;
        const isActive = activeChunkId === c.id;
        const onClick = () => {
          if (!hasPage) return;
          setActiveChunkId(c.id);
          jumpToPage(meta.page!);
        };

        return (
          <Card
            key={c.id}
            className={cn(
              'border-muted transition-all',
              hasPage && 'cursor-pointer hover:border-primary/40 hover:bg-muted/40',
              !hasPage && 'opacity-70',
              isActive && 'border-primary ring-1 ring-primary/40 bg-primary/5',
            )}
          >
            <button
              type="button"
              onClick={onClick}
              disabled={!hasPage}
              aria-label={
                hasPage
                  ? `Mở chunk #${meta.chunkIndex ?? i} tại trang ${meta.page}`
                  : `Chunk #${meta.chunkIndex ?? i} (không có thông tin trang)`
              }
              className="w-full text-left disabled:cursor-default"
            >
              <CardContent className="space-y-1 py-3 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="font-mono">#{meta.chunkIndex ?? i}</span>
                  <span>
                    {hasPage ? `trang ${meta.page} · ` : ''}
                    {c.tokens} tok
                  </span>
                </div>
                <p className="line-clamp-4 text-foreground/90">{c.content}</p>
              </CardContent>
            </button>
          </Card>
        );
      })}
    </div>
  );
}
