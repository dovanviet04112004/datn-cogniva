'use client';

import * as React from 'react';

export type Density = 'cozy' | 'compact';

type Ctx = {
  density: Density;
  setDensity: (d: Density) => void;
};

const DEFAULT: Density = 'cozy';
const COOKIE_NAME = 'cogniva.chat-density';

const Context = React.createContext<Ctx>({
  density: DEFAULT,
  setDensity: () => undefined,
});

export function useDensity(): Ctx {
  return React.useContext(Context);
}

export function DensityProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    try {
      if (document.cookie.includes(`${COOKIE_NAME}=compact`)) {
        document.cookie = `${COOKIE_NAME}=cozy; path=/; max-age=0`;
      }
    } catch {}
  }, []);

  const value = React.useMemo<Ctx>(() => ({ density: 'cozy', setDensity: () => undefined }), []);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
