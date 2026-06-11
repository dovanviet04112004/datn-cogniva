'use client';

import * as React from 'react';
import { FileText, Loader2, Maximize2, X } from 'lucide-react';

import { useDocPreview } from '@/components/chat/doc-preview-context';
import { PdfViewer } from '@/components/documents/pdf-viewer';

export function SourcesInlinePreview() {
  const ctx = useDocPreview();

  if (!ctx?.citation) return null;

  const baseCitation = ctx.citation;
  const filename = baseCitation.filename;
  const page = baseCitation.page;
  const docId = baseCitation.documentId;
  const isCitationMode = baseCitation.n > 0;
  const pdfSrc = `/api/documents/${docId}/file`;

  return (
    <aside className="bg-card flex h-full flex-col overflow-hidden border-r">
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-start gap-2">
          <FileText className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p
            className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight"
            title={filename}
          >
            {filename}
          </p>
          <button
            type="button"
            onClick={() => ctx.setMode('modal')}
            aria-label="Phóng to modal"
            title="Mở rộng (full screen)"
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => ctx.close()}
            aria-label="Đóng — quay lại danh sách"
            title="Đóng"
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {(isCitationMode || page !== null) && (
          <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-[11px]">
            {isCitationMode && <span>Nguồn #{baseCitation.n}</span>}
            {isCitationMode && page !== null && <span>·</span>}
            {page !== null && <span>Trang {page}</span>}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {docId ? (
          <PdfViewer src={pdfSrc} initialPage={page ?? 1} compact />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          </div>
        )}
      </div>
    </aside>
  );
}
