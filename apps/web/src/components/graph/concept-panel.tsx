/**
 * ConceptPanel — side panel hiển thị chi tiết khi user click node graph.
 *
 * Fetch /api/graph/concept/[id] khi conceptId đổi, hiển thị:
 *   - name + domain badge + description
 *   - list 10 chunks liên quan (snippet + filename + page)
 *   - click chunk → mở /documents/[id]#page-N (cùng pattern citation chat)
 *
 * Layout: Sheet from right (Radix Dialog) hoặc panel cố định.
 * Phase 4 v1 dùng panel cố định cho gọn — Sheet sẽ swap khi UX cần overlay.
 */
'use client';

import Link from 'next/link';
import { ExternalLink, Loader2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import type { ConceptDetailDTO } from '@cogniva/shared/types';
import { cn } from '@/lib/utils';

type Props = {
  conceptId: string | null;
  onClose: () => void;
};

export function ConceptPanel({ conceptId, onClose }: Props) {
  // React Query: chỉ fetch khi có conceptId; cache theo concept → click lại node
  // đã xem hiện ngay.
  const { data, isLoading: loading } = useQuery({
    queryKey: qk.graphConcept(conceptId ?? ''),
    queryFn: () => apiGet<ConceptDetailDTO>(`/api/graph/concept/${conceptId}`),
    enabled: !!conceptId,
  });

  return (
    <aside
      className={cn(
        'flex h-full w-80 shrink-0 flex-col border-l bg-card transition-all',
        // Khi không có conceptId, panel ẩn (width 0)
        !conceptId && 'w-0 overflow-hidden border-l-0',
      )}
    >
      {conceptId && (
        <>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Concept</h3>
            <button
              onClick={onClose}
              className="rounded p-1 hover:bg-muted"
              aria-label="Đóng"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {loading && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}

            {data && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold leading-tight">{data.concept.name}</h2>
                  <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                    {data.concept.domain}
                  </span>
                  {data.concept.description && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {data.concept.description}
                    </p>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Xuất hiện trong
                  </h4>
                  {data.chunks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Chưa có chunk nào — concept này có thể bị link sai.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {data.chunks.map((chunk) => (
                        <li key={chunk.id}>
                          <Link
                            href={`/documents/${chunk.documentId}${chunk.page ? `#page-${chunk.page}` : ''}`}
                            className="block rounded-md border p-2 text-sm hover:bg-muted"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-medium text-foreground">
                                {chunk.filename}
                                {chunk.page && (
                                  <span className="ml-1 text-muted-foreground">
                                    · trang {chunk.page}
                                  </span>
                                )}
                              </span>
                              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                            </div>
                            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                              {chunk.snippet}
                            </p>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
