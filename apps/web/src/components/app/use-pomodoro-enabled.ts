/**
 * usePomodoroEnabled — hook đọc/ghi preference hiện Pomodoro widget trên topbar.
 *
 * Storage: localStorage key `cogniva.pomodoro-enabled`. Default false (off cho
 * user mới — feature opt-in, tránh clutter UI lần đầu vào).
 *
 * Cross-tab sync: lắng nghe `storage` event để khi user toggle ở Settings tab
 * → Topbar tab cũng update real-time.
 *
 * SSR: trả false trong render đầu tiên (chưa có localStorage), useEffect đọc
 * sau mount → tránh hydration mismatch.
 */
'use client';

import * as React from 'react';

const STORAGE_KEY = 'cogniva.pomodoro-enabled';

export function usePomodoroEnabled(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  // Đọc localStorage sau mount để tránh hydration mismatch
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      setEnabled(raw === 'true');
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // Cross-tab sync — khi tab khác đổi → tab hiện tại update theo
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
    } catch {
      /* ignore */
    }
  }, []);

  // Pre-hydration: luôn trả false để SSR/CSR khớp
  return [hydrated && enabled, update];
}
