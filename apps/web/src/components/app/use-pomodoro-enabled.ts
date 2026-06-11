'use client';

import * as React from 'react';

const STORAGE_KEY = 'cogniva.pomodoro-enabled';

export function usePomodoroEnabled(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      setEnabled(raw === 'true');
    } catch {}
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setEnabled(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = React.useCallback((next: boolean) => {
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {}
  }, []);

  return [hydrated && enabled, update];
}
