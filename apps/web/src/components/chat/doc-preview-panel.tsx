/**
 * DocPreviewPanel — side panel hiện PDF + jump to page khi user click citation
 * trong chat. Đỡ phải navigate sang /documents/[id] (mất context chat).
 *
 * Layout: panel cố định bên phải chat, resizable height = full, width ~50%.
 * Mobile: chiếm full screen với overlay (Phase v2 sẽ thêm responsive — hiện
 * desktop only, mobile fallback navigate full page).
 *
 * Wire flow:
 *   1. User click citation [1] → ChatInterface setState docPreview = {...}
 *   2. Panel mount → load PDF qua /api/documents/{id}/file
 *   3. PdfViewer scroll tới page citation
 *   4. Switch citation khác → state update → PdfViewer re-scroll (cùng instance)
 *   5. Close → state null → panel unmount
 */
'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, FileText, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PdfViewer } from '@/components/documents/pdf-viewer';

import type { CitationData } from './citation';

interface Props {
  citation: CitationData;
  onClose: () => void;
}

export function DocPreviewPanel({ citation, onClose }: Props) {
  // DEBUG: log citation để verify shape khi user click
  // eslint-disable-next-line no-console
  console.log('[doc-preview] citation:', citation);

  // Force PdfViewer remount khi đổi document để worker reload sạch
  const pdfSrc = `/api/documents/${citation.documentId}/file`;

  // ESC để đóng — UX chuẩn dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="flex h-full w-full flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={citation.filename}>
            {citation.filename}
          </p>
          <p className="text-xs text-muted-foreground">
            {citation.page ? `Trang ${citation.page}` : 'Vị trí không xác định'}
            {' · '}
            <span>{(citation.score * 100).toFixed(0)}% match</span>
          </p>
        </div>
        <a
          href={`/documents/${citation.documentId}${citation.page ? `#page-${citation.page}` : ''}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded p-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Mở trang riêng"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Đóng"
          className="h-7 w-7"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Snippet citation — show context user đã chọn */}
      <div className="border-b bg-muted/30 px-4 py-2">
        <p className="line-clamp-3 text-xs italic text-muted-foreground">
          "{citation.snippet}"
        </p>
      </div>

      {/* PDF viewer — key reset khi đổi doc để remount worker */}
      <div className="min-h-0 flex-1">
        <PdfViewer
          key={citation.documentId}
          src={pdfSrc}
          initialPage={citation.page ?? 1}
        />
      </div>
    </div>
  );
}
