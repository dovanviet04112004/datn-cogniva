'use client';

import * as React from 'react';

import type { CitationData } from './citation-renderer';

export type DocPreviewMode = 'inline' | 'modal';

export type DocPreviewContextValue = {
  citation: CitationData | null;
  mode: DocPreviewMode;
  supportInline: boolean;
  openCitation: (citation: CitationData) => void;
  openDocument: (params: { documentId: string; filename: string; page?: number | null }) => void;
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
  supportInline?: boolean;
}) {
  const [citation, setCitation] = React.useState<CitationData | null>(null);
  const [mode, setModeState] = React.useState<DocPreviewMode>('modal');

  const openCitation = React.useCallback(
    (c: CitationData) => {
      setCitation(c);
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
      setModeState(supportInline ? 'inline' : 'modal');
    },
    [supportInline],
  );

  const setMode = React.useCallback((m: DocPreviewMode) => {
    setModeState(m);
  }, []);

  const close = React.useCallback(() => {
    setCitation(null);
    setModeState('modal');
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

  return <DocPreviewContext.Provider value={value}>{children}</DocPreviewContext.Provider>;
}
