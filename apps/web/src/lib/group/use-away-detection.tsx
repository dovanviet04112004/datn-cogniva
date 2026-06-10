/**
 * useAwayDetection — V2 G3.6 (2026-05-21).
 *
 * Auto-switch user status sang 'idle' khi:
 *   - 15 phút không có input (mouse/keyboard/touch)
 *   - HOẶC tab inactive (visibilitychange → hidden)
 *
 * Khi user active lại → revert về 'online'.
 *
 * Spec: docs/plans/study-group-v2.md §G3.
 *
 * Logic:
 *   - Self-managed timer; reset mỗi event input
 *   - PUT /api/user/status fire-and-forget (best effort)
 *   - KHÔNG override status DND/invisible user tự set (gọi GET trước mỗi
 *     transition để tránh phá user intent). DND/invisible đè lên auto-idle.
 *
 * Mount 1 lần ở root layout (sau khi authenticated).
 */
'use client';

import * as React from 'react';

const IDLE_THRESHOLD_MS = 15 * 60 * 1000; // 15 phút
const ACTIVE_EVENTS: (keyof DocumentEventMap)[] = [
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
];

type ManagedStatus = 'online' | 'idle';

/**
 * Hook tự handle idle detect. Caller (root layout) chỉ cần mount.
 * Return current managedStatus (chủ yếu để debug — UI dùng UserMenu fetch riêng).
 */
export function useAwayDetection(enabled: boolean = true): ManagedStatus {
  const [managed, setManaged] = React.useState<ManagedStatus>('online');
  // Ref giữ status DB hiện tại để skip override DND/invisible
  const userSetStatusRef = React.useRef<string | null>(null);

  // Initial fetch để biết user đã tự set DND/invisible chưa
  React.useEffect(() => {
    if (!enabled) return;
    fetch('/api/user/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { storedStatus?: string } | null) => {
        userSetStatusRef.current = d?.storedStatus ?? 'online';
      })
      .catch(() => {
        /* silent */
      });
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    /** Skip auto-transition nếu user đã chủ động set 'dnd' / 'invisible'. */
    const isOverridden = () =>
      userSetStatusRef.current === 'dnd' ||
      userSetStatusRef.current === 'invisible';

    const fireStatus = async (next: ManagedStatus) => {
      if (isOverridden()) return;
      // Skip nếu đã ở state đó (ref tracks last fired)
      if (managed === next) return;
      setManaged(next);
      try {
        await fetch('/api/user/status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next, expiresInSec: null }),
        });
      } catch {
        /* silent — best effort */
      }
    };

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      // Active lại → online
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
    // Start initial timer
    resetIdleTimer();

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      for (const ev of ACTIVE_EVENTS) {
        document.removeEventListener(ev, resetIdleTimer);
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // managed is intentionally NOT a dep — handler reads via closure but only
    // matters for transition direction; reset on each cycle works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return managed;
}

/**
 * AwayDetector — wrapper component dạng `<AwayDetector />` mount ở app layout.
 * Không render gì.
 */
export function AwayDetector() {
  useAwayDetection(true);
  return null;
}
