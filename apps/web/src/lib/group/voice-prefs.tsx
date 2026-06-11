'use client';

import * as React from 'react';

export type VoiceMode = 'voice' | 'ptt' | 'open';

export interface VoicePrefs {
  mode: VoiceMode;
  pttKey: string;
}

const DEFAULTS: VoicePrefs = {
  mode: 'voice',
  pttKey: 'Space',
};

const STORAGE_KEY = 'cogniva.voice.prefs';

type Ctx = {
  prefs: VoicePrefs;
  setMode: (m: VoiceMode) => void;
  setPttKey: (k: string) => void;
};

const VoicePrefsContext = React.createContext<Ctx | null>(null);

function readPrefs(): VoicePrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<VoicePrefs>;
    return {
      mode: parsed.mode === 'ptt' || parsed.mode === 'open' ? parsed.mode : 'voice',
      pttKey:
        typeof parsed.pttKey === 'string' && parsed.pttKey.length > 0
          ? parsed.pttKey
          : DEFAULTS.pttKey,
    };
  } catch {
    return DEFAULTS;
  }
}

function writePrefs(p: VoicePrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {}
}

export function VoicePrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = React.useState<VoicePrefs>(DEFAULTS);

  React.useEffect(() => {
    setPrefs(readPrefs());
  }, []);

  const setMode = React.useCallback((mode: VoiceMode) => {
    setPrefs((p) => {
      const next = { ...p, mode };
      writePrefs(next);
      return next;
    });
  }, []);

  const setPttKey = React.useCallback((pttKey: string) => {
    setPrefs((p) => {
      const next = { ...p, pttKey };
      writePrefs(next);
      return next;
    });
  }, []);

  const value = React.useMemo(() => ({ prefs, setMode, setPttKey }), [prefs, setMode, setPttKey]);

  return <VoicePrefsContext.Provider value={value}>{children}</VoicePrefsContext.Provider>;
}

export function useVoicePrefs(): Ctx {
  const ctx = React.useContext(VoicePrefsContext);
  if (!ctx) throw new Error('useVoicePrefs phải dùng trong <VoicePrefsProvider>');
  return ctx;
}

export function formatPttKey(key: string): string {
  if (key === 'Space') return 'Space';
  if (key.startsWith('Key')) return key.slice(3);
  if (key.startsWith('Digit')) return key.slice(5);
  return key.replace('Left', ' ←').replace('Right', ' →');
}
