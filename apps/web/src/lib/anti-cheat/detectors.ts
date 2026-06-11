'use client';

import * as React from 'react';

export type ViolationType =
  | 'tab_switch'
  | 'fullscreen_exit'
  | 'copy'
  | 'paste'
  | 'cut'
  | 'context_menu'
  | 'devtools'
  | 'webcam_denied'
  | 'webcam_missing'
  | 'mic_denied'
  | 'mic_silent'
  | 'no_face'
  | 'multiple_faces'
  | 'looking_away';

export type Severity = 'low' | 'medium' | 'high';

export interface ViolationEvent {
  type: ViolationType;
  severity: Severity;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export function useFullscreenLock(enabled: boolean, onViolation: (v: ViolationEvent) => void) {
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  const enter = React.useCallback(async () => {
    try {
      const el = document.documentElement;
      const req =
        el.requestFullscreen ??
        (el as unknown as { webkitRequestFullscreen?: () => Promise<void> })
          .webkitRequestFullscreen;
      if (!req) {
        onViolation({
          type: 'fullscreen_exit',
          severity: 'high',
          timestamp: Date.now(),
          metadata: { reason: 'api_unsupported' },
        });
        return;
      }
      await req.call(el);
      setIsFullscreen(true);
    } catch (err) {
      onViolation({
        type: 'fullscreen_exit',
        severity: 'high',
        timestamp: Date.now(),
        metadata: { reason: 'enter_failed', error: String(err) },
      });
    }
  }, [onViolation]);

  React.useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      const fs = Boolean(
        document.fullscreenElement ??
        (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement,
      );
      setIsFullscreen(fs);
      if (!fs) {
        onViolation({
          type: 'fullscreen_exit',
          severity: 'high',
          timestamp: Date.now(),
        });
      }
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, [enabled, onViolation]);

  return { isFullscreen, enter };
}

export function useTabSwitchDetection(enabled: boolean, onViolation: (v: ViolationEvent) => void) {
  React.useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        onViolation({
          type: 'tab_switch',
          severity: 'medium',
          timestamp: Date.now(),
          metadata: { trigger: 'visibilitychange' },
        });
      }
    };
    const onBlur = () => {
      onViolation({
        type: 'tab_switch',
        severity: 'medium',
        timestamp: Date.now(),
        metadata: { trigger: 'window_blur' },
      });
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled, onViolation]);
}

export function useCopyPasteBlock(enabled: boolean, onViolation: (v: ViolationEvent) => void) {
  React.useEffect(() => {
    if (!enabled) return;
    const handler = (e: ClipboardEvent) => {
      const type = e.type as 'copy' | 'paste' | 'cut';
      e.preventDefault();
      onViolation({
        type,
        severity: 'low',
        timestamp: Date.now(),
      });
    };
    document.addEventListener('copy', handler);
    document.addEventListener('paste', handler);
    document.addEventListener('cut', handler);
    return () => {
      document.removeEventListener('copy', handler);
      document.removeEventListener('paste', handler);
      document.removeEventListener('cut', handler);
    };
  }, [enabled, onViolation]);
}

export function useContextMenuBlock(enabled: boolean, onViolation: (v: ViolationEvent) => void) {
  React.useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      onViolation({
        type: 'context_menu',
        severity: 'low',
        timestamp: Date.now(),
      });
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, [enabled, onViolation]);
}

export function useDevtoolsDetect(enabled: boolean, onViolation: (v: ViolationEvent) => void) {
  React.useEffect(() => {
    if (!enabled) return;
    let alerted = false;
    let lastReason: string | null = null;

    const sizeCheck = () => {
      const widthGap = window.outerWidth - window.innerWidth;
      const heightGap = window.outerHeight - window.innerHeight;
      if ((widthGap > 160 || heightGap > 160) && !alerted) {
        alerted = true;
        lastReason = 'size-gap';
        onViolation({
          type: 'devtools',
          severity: 'high',
          timestamp: Date.now(),
          metadata: { strategy: 'size-gap', widthGap, heightGap },
        });
      } else if (widthGap < 100 && heightGap < 100 && lastReason === 'size-gap') {
        alerted = false;
        lastReason = null;
      }
    };

    const getterCheck = () => {
      let triggered = false;
      const probe: Record<string, unknown> = {};
      Object.defineProperty(probe, 'id', {
        get() {
          triggered = true;
          return 'devtools-probe';
        },
      });
      // eslint-disable-next-line no-console
      console.log('%c', probe);
      Promise.resolve().then(() => {
        if (triggered && !alerted) {
          alerted = true;
          lastReason = 'console-getter';
          onViolation({
            type: 'devtools',
            severity: 'high',
            timestamp: Date.now(),
            metadata: { strategy: 'console-getter' },
          });
        }
      });
    };

    const interval = setInterval(() => {
      sizeCheck();
      getterCheck();
    }, 2000);

    const onKey = (e: KeyboardEvent) => {
      const key = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const isF12 = key === 'F12';
      const isInspect =
        ctrl &&
        shift &&
        (key === 'I' || key === 'i' || key === 'J' || key === 'j' || key === 'C' || key === 'c');
      const isViewSource = ctrl && (key === 'U' || key === 'u');
      if (isF12 || isInspect || isViewSource) {
        e.preventDefault();
        e.stopPropagation();
        onViolation({
          type: 'devtools',
          severity: 'high',
          timestamp: Date.now(),
          metadata: {
            strategy: 'keydown-shortcut',
            key,
            ctrl,
            shift,
          },
        });
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      clearInterval(interval);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [enabled, onViolation]);
}

export function useReportViolations(attemptId: string | null) {
  const queueRef = React.useRef<ViolationEvent[]>([]);
  const flushingRef = React.useRef(false);

  const flush = React.useCallback(async () => {
    if (!attemptId || flushingRef.current) return;
    if (queueRef.current.length === 0) return;
    flushingRef.current = true;
    const batch = queueRef.current.splice(0);
    try {
      const res = await fetch(`/api/attempts/${attemptId}/violations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) {
        queueRef.current.unshift(...batch);
      }
    } catch {
      queueRef.current.unshift(...batch);
    } finally {
      flushingRef.current = false;
    }
  }, [attemptId]);

  const report = React.useCallback(
    (v: ViolationEvent) => {
      queueRef.current.push(v);
      window.setTimeout(flush, 1000);
    },
    [flush],
  );

  React.useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  return report;
}
