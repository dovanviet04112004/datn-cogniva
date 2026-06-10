/**
 * DocPreviewContext — quản lý state right-side document preview khi user
 * click citation badge trong chat.
 *
 * V8 (2026-05-20). Reuse pattern từ V4 chat-interface DocPreviewPanel (đã
 * xoá ở V7), nhưng giờ là context dùng được từ cả workspace chat lẫn
 * /chat/[id] standalone.
 *
 * UI: panel sticky bên phải, show citation hiện tại. Click citation khác
 * → panel update (không add stack). Close → biến mất.
 *
 * Provider mounted ở:
 *   - WorkspaceNotebook — panel chiếm chỗ Studio khi active
 *   - Chat detail wrapper — panel render bên phải cùng layout
 */
'use client';

import * as React from 'react';

import type { CitationData } from './citation-renderer';

/**
 * V8.8: mode 3-state flow NotebookLM:
 *   - null: chưa có doc nào (sidebar list bình thường)
 *   - 'inline': sidebar content swap thành doc preview (chỉ có khi
 *     supportInline=true — workspace có SourcesPanel host)
 *   - 'modal': modal floating overlay che giao diện
 *
 * Transitions điển hình:
 *   - Click doc trong SourcesPanel → openDocument → 'inline'
 *   - Click [N] citation trong chat → openCitation → 'modal'
 *   - Zoom button trong inline → setMode('modal')
 *   - Minimize button trong modal → setMode('inline') (nếu supportInline)
 *                                    hoặc close() (nếu không)
 *   - X button (cả inline + modal) → close
 */
export type DocPreviewMode = 'inline' | 'modal';

export type DocPreviewContextValue = {
  citation: CitationData | null;
  mode: DocPreviewMode;
  /** Có host inline (vd SourcesPanel) không — quyết định minimize behavior. */
  supportInline: boolean;
  /** Citation click trong chat → modal trực tiếp. */
  openCitation: (citation: CitationData) => void;
  /**
   * Click doc trong SourcesPanel → inline (nếu supportInline) hoặc modal.
   * Synthesize citation n=0/chunkId='' để panel biết là direct doc open.
   */
  openDocument: (params: {
    documentId: string;
    filename: string;
    page?: number | null;
  }) => void;
  setMode: (mode: DocPreviewMode) => void;
  close: () => void;
};

const DocPreviewContext = React.createContext<DocPreviewContextValue | null>(null);

export function useDocPreview(): DocPreviewContextValue | null {
  return React.useContext(DocPreviewContext);
}

export function DocPreviewProvider({
  children,
  supportInline = false,
}: {
  children: React.ReactNode;
  /** True nếu app có host inline (vd workspace SourcesPanel). */
  supportInline?: boolean;
}) {
  const [citation, setCitation] = React.useState<CitationData | null>(null);
  const [mode, setModeState] = React.useState<DocPreviewMode>('modal');

  const openCitation = React.useCallback(
    (c: CitationData) => {
      setCitation(c);
      // V8.9: citation click trong chat cũng vào inline trước (nếu có host)
      // — user phải zoom mới thành modal. Khớp với NotebookLM pattern.
      setModeState(supportInline ? 'inline' : 'modal');
    },
    [supportInline],
  );

  const openDocument = React.useCallback(
    ({
      documentId,
      filename,
      page = null,
    }: {
      documentId: string;
      filename: string;
      page?: number | null;
    }) => {
      setCitation({
        n: 0,
        chunkId: '',
        documentId,
        filename,
        page,
        score: 0,
        snippet: '',
      });
      // Sources click → inline (nếu host hỗ trợ), else modal
      setModeState(supportInline ? 'inline' : 'modal');
    },
    [supportInline],
  );

  const setMode = React.useCallback((m: DocPreviewMode) => {
    setModeState(m);
  }, []);

  const close = React.useCallback(() => {
    setCitation(null);
    setModeState('modal'); // reset cho lần mở sau
  }, []);

  const value = React.useMemo<DocPreviewContextValue>(
    () => ({
      citation,
      mode,
      supportInline,
      openCitation,
      openDocument,
      setMode,
      close,
    }),
    [citation, mode, supportInline, openCitation, openDocument, setMode, close],
  );

  return (
    <DocPreviewContext.Provider value={value}>
      {children}
    </DocPreviewContext.Provider>
  );
}
