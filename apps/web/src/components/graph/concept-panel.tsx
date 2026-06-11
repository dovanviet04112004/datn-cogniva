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
  const { data, isLoading: loading } = useQuery({
    queryKey: qk.graphConcept(conceptId ?? ''),
    queryFn: () => apiGet<ConceptDetailDTO>(`/api/graph/concept/${conceptId}`),
    enabled: !!conceptId,
  });

  return (
    <aside
      className={cn(
        'bg-card flex h-full w-80 shrink-0 flex-col border-l transition-all',
        !conceptId && 'w-0 overflow-hidden border-l-0',
      )}
    >
      {conceptId && (
        <>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Concept</h3>
            <button onClick={onClose} className="hover:bg-muted rounded p-1" aria-label="Đóng">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {loading && (
              <div className="text-muted-foreground flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}

            {data && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold leading-tight">{data.concept.name}</h2>
                  <span className="bg-muted text-muted-foreground mt-1 inline-block rounded-full px-2 py-0.5 text-xs uppercase tracking-wider">
                    {data.concept.domain}
                  </span>
                  {data.concept.description && (
                    <p className="text-muted-foreground mt-2 text-sm">{data.concept.description}</p>
                  )}
                </div>

                <div>
                  <h4 className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wider">
                    Xuất hiện trong
                  </h4>
                  {data.chunks.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Chưa có chunk nào — concept này có thể bị link sai.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {data.chunks.map((chunk) => (
                        <li key={chunk.id}>
                          <Link
                            href={`/documents/${chunk.documentId}${chunk.page ? `#page-${chunk.page}` : ''}`}
                            className="hover:bg-muted block rounded-md border p-2 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-foreground truncate text-xs font-medium">
                                {chunk.filename}
                                {chunk.page && (
                                  <span className="text-muted-foreground ml-1">
                                    · trang {chunk.page}
                                  </span>
                                )}
                              </span>
                              <ExternalLink className="text-muted-foreground h-3 w-3 shrink-0" />
                            </div>
                            <p className="text-muted-foreground mt-1 line-clamp-3 text-xs">
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
