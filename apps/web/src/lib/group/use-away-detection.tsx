'use client';

import * as React from 'react';

const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
const ACTIVE_EVENTS: (keyof DocumentEventMap)[] = ['mousedown', 'keydown', 'touchstart', 'scroll'];

type ManagedStatus = 'online' | 'idle';

export function useAwayDetection(enabled: boolean = true): ManagedStatus {
  const [managed, setManaged] = React.useState<ManagedStatus>('online');
  const userSetStatusRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    fetch('/api/user/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { storedStatus?: string } | null) => {
        userSetStatusRef.current = d?.storedStatus ?? 'online';
      })
      .catch(() => {});
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const isOverridden = () =>
      userSetStatusRef.current === 'dnd' || userSetStatusRef.current === 'invisible';

    const fireStatus = async (next: ManagedStatus) => {
      if (isOverridden()) return;
      if (managed === next) return;
      setManaged(next);
      try {
        await fetch('/api/user/status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next, expiresInSec: null }),
        });
      } catch {}
    };

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (managed === 'idle') void fireStatus('online');
      idleTimer = setTimeout(() => {
        void fireStatus('idle');
      }, IDLE_THRESHOLD_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (idleTimer) clearTimeout(idleTimer);
        void fireStatus('idle');
      } else {
        resetIdleTimer();
      }
    };

    for (const ev of ACTIVE_EVENTS) {
      document.addEventListener(ev, resetIdleTimer, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    resetIdleTimer();

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      for (const ev of ACTIVE_EVENTS) {
        document.removeEventListener(ev, resetIdleTimer);
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return managed;
}

export function AwayDetector() {
  useAwayDetection(true);
  return null;
}
