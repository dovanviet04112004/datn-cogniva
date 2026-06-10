/**
 * SourcesInlinePreview — V8.9 (2026-05-20).
 *
 * Render khi `useDocPreview().mode === 'inline'` — sidebar Sources tạm
 * thời thay đổi content thành **PDF compact preview** của document đang
 * xem (NotebookLM source viewer pattern).
 *
 * Layout (fit 320px sidebar width):
 *   - Header: filename + zoom + X (close → back to list)
 *   - Meta strip: "Nguồn #N · Trang X"
 *   - Body: PdfViewer compact — fit-width tự scale theo 320px, có toolbar
 *     trang trước/sau + zoom
 *   - Footer: link "Mở rộng để đọc đầy đủ"
 *
 * KHÔNG render chunks list (V8.8 cũ) — theo feedback user "cần hiện pdf
 * đừng hiện chunk". Chunks vẫn xem được trong modal (qua nút toggle).
 */
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
    <aside className="flex h-full flex-col overflow-hidden border-r bg-card">
      {/* Header — filename + zoom + close */}
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
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
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => ctx.close()}
            aria-label="Đóng — quay lại danh sách"
            title="Đóng"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {(isCitationMode || page !== null) && (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {isCitationMode && <span>Nguồn #{baseCitation.n}</span>}
            {isCitationMode && page !== null && <span>·</span>}
            {page !== null && <span>Trang {page}</span>}
          </div>
        )}
      </header>

      {/* PDF body — compact, fit-width tự scale theo 320px sidebar.
          (Đã bỏ footer "Mở rộng để đọc đầy đủ" — trùng nút zoom ở header.) */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {docId ? (
          <PdfViewer src={pdfSrc} initialPage={page ?? 1} compact />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </aside>
  );
}
