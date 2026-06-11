'use client';

import * as React from 'react';

const FloatingDockContext = React.createContext<HTMLElement | null>(null);

export function FloatingDockProvider({ children }: { children: React.ReactNode }) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  return (
    <FloatingDockContext.Provider value={host}>
      {children}
      <div
        ref={setHost}
        className="pointer-events-none fixed bottom-3 right-4 z-40 flex flex-row-reverse items-end gap-3"
      />
    </FloatingDockContext.Provider>
  );
}

export function useFloatingDockHost(): HTMLElement | null {
  return React.useContext(FloatingDockContext);
}
