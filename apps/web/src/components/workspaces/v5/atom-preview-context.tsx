/**
 * AtomPreviewContext — V8.10 (2026-05-20).
 *
 * Quản lý state khi user click atom row trong SourcesPanel → render inline
 * preview thay danh sách (giống DocPreview cho documents). Không có modal
 * mode vì atom info text-only, không cần fullscreen.
 *
 * Coexist với DocPreviewContext: mở atom → close doc (và vice versa) — do
 * SourcesPanel xử lý ở handler click, không phải ở context.
 */
'use client';

import * as React from 'react';

export type AtomPreviewContextValue = {
  atomId: string | null;
  open: (atomId: string) => void;
  close: () => void;
};

const AtomPreviewContext = React.createContext<AtomPreviewContextValue | null>(
  null,
);

export function useAtomPreview(): AtomPreviewContextValue | null {
  return React.useContext(AtomPreviewContext);
}

export function AtomPreviewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [atomId, setAtomId] = React.useState<string | null>(null);

  const open = React.useCallback((id: string) => {
    setAtomId(id);
  }, []);

  const close = React.useCallback(() => {
    setAtomId(null);
  }, []);

  const value = React.useMemo<AtomPreviewContextValue>(
    () => ({ atomId, open, close }),
    [atomId, open, close],
  );

  return (
    <AtomPreviewContext.Provider value={value}>
      {children}
    </AtomPreviewContext.Provider>
  );
}
