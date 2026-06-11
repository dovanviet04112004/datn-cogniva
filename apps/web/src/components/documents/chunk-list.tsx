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

  useEffect(() => {
    const matchInitial = window.location.hash.match(/^#page-(\d+)$/);
    if (!matchInitial) return;
    const page = parseInt(matchInitial[1]!, 10);
    const first = chunks.find((c) => (c.metadata as { page?: number } | null)?.page === page);
    if (first) setActiveChunkId(first.id);
  }, [chunks]);

  if (chunks.length === 0) {
    return <p className="text-muted-foreground text-xs">Chưa có chunk nào.</p>;
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
              hasPage && 'hover:border-primary/40 hover:bg-muted/40 cursor-pointer',
              !hasPage && 'opacity-70',
              isActive && 'border-primary ring-primary/40 bg-primary/5 ring-1',
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
                <div className="text-muted-foreground flex items-center justify-between">
                  <span className="font-mono">#{meta.chunkIndex ?? i}</span>
                  <span>
                    {hasPage ? `trang ${meta.page} · ` : ''}
                    {c.tokens} tok
                  </span>
                </div>
                <p className="text-foreground/90 line-clamp-4">{c.content}</p>
              </CardContent>
            </button>
          </Card>
        );
      })}
    </div>
  );
}
