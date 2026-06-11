'use client';

import * as React from 'react';

export type AtomPreviewContextValue = {
  atomId: string | null;
  open: (atomId: string) => void;
  close: () => void;
};

const AtomPreviewContext = React.createContext<AtomPreviewContextValue | null>(null);

export function useAtomPreview(): AtomPreviewContextValue | null {
  return React.useContext(AtomPreviewContext);
}

export function AtomPreviewProvider({ children }: { children: React.ReactNode }) {
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

  return <AtomPreviewContext.Provider value={value}>{children}</AtomPreviewContext.Provider>;
}
