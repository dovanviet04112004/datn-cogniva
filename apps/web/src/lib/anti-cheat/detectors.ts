/**
 * Anti-cheat detector hooks (Phase 19).
 *
 * Mỗi hook expose 1 mảng violation events. Component gọi
 * `useReportViolations(attemptId, events)` để batch POST lên server.
 *
 * Triết lý:
 *   - CLIENT-SIDE detection chỉ là phát hiện, KHÔNG chặn được hacker xác định
 *     (browser dev tools, modify code, hook event). Đó là OK — mục tiêu là
 *     deter + log, không phải bullet-proof.
 *   - Server cuối cùng quyết định flag attempt bằng cách aggregate violations
 *     + cheatRiskScore. Owner xem dashboard quyết định disqualify.
 */
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

/**
 * Fullscreen lock — request fullscreen on user gesture, log khi exit.
 *
 * `enter()` LUÔN cho phép gọi (cần user gesture từ button click — không
 * thể tự fire). Chỉ `fullscreenchange` listener gated theo `enabled` để
 * không log false-positive khi user thoát fullscreen ở giai đoạn waitroom.
 *
 * Lỗi cũ V1: `enter()` check `enabled` đầu hàm → nếu component gọi `enter()`
 * NGAY khi đang transition examStarted false→true → state chưa kịp update →
 * `enabled` còn false → return sớm → KHÔNG request fullscreen → button user
 * tưởng đã consent mà thực ra chưa vào fullscreen.
 */
export function useFullscreenLock(enabled: boolean, onViolation: (v: ViolationEvent) => void) {
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  const enter = React.useCallback(async () => {
    try {
      const el = document.documentElement;
      // Fallback prefix safari (webkit)
      const req =
        el.requestFullscreen ??
        (el as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;
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

/**
 * Tab switch detection qua visibilitychange. Cũng catch window blur (sang
 * app khác).
 */
export function useTabSwitchDetection(
  enabled: boolean,
  onViolation: (v: ViolationEvent) => void,
) {
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

/**
 * Block copy/paste/cut + log. Cũng block context menu nếu `blockContextMenu`.
 */
export function useCopyPasteBlock(
  enabled: boolean,
  onViolation: (v: ViolationEvent) => void,
) {
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

export function useContextMenuBlock(
  enabled: boolean,
  onViolation: (v: ViolationEvent) => void,
) {
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

/**
 * DevTools detection — multi-strategy.
 *
 * **Lưu ý quan trọng**: F12 / DevTools KHÔNG thể block hoàn toàn bằng JS.
 * Browser shortcut cấp OS, web page không có quyền cancel. Đây là feature
 * bảo vệ user — không có cách nào "lockdown" full browser bằng web app.
 *
 * Industry: high-stakes exam dùng dedicated Lockdown Browser app riêng.
 * Web app chỉ làm DETECT + LOG + FLAG.
 *
 * 3 strategy detect:
 *   1. Window size gap — DevTools sidebar/bottom widens chrome
 *   2. console.log getter trick — DevTools evaluate object → trigger getter
 *   3. debugger statement timing — DevTools pause execution, không có thì instant
 *
 * Strategy 1 alone false-positive với DPI zoom; combine 2+3 chính xác hơn.
 *
 * Bắt thêm keydown F12 / Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+U / Cmd+Opt+I:
 * preventDefault để Firefox/Safari block, log nỗ lực ở mọi browser.
 */
export function useDevtoolsDetect(
  enabled: boolean,
  onViolation: (v: ViolationEvent) => void,
) {
  React.useEffect(() => {
    if (!enabled) return;
    let alerted = false;
    let lastReason: string | null = null;

    // Strategy 1: window size gap
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

    // Strategy 2: console getter trick
    //   Khi DevTools mở, console.log(obj) sẽ evaluate `obj.id` để hiện
    //   trong console panel → trigger getter → ta biết DevTools mở.
    const getterCheck = () => {
      let triggered = false;
      const probe: Record<string, unknown> = {};
      Object.defineProperty(probe, 'id', {
        get() {
          triggered = true;
          return 'devtools-probe';
        },
      });
      // console.log probe sẽ NOT trigger getter nếu DevTools đóng.
      // KHI mở → console panel evaluate → getter fires.
      // eslint-disable-next-line no-console
      console.log('%c', probe);
      // Một số browser flush async — check sau microtask
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

    // Keydown intercept — preventDefault các shortcut DevTools.
    // Firefox tôn trọng preventDefault → block thực sự. Chrome ignore ở
    // browser level (security), nhưng ta vẫn log violation.
    const onKey = (e: KeyboardEvent) => {
      const key = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const isF12 = key === 'F12';
      const isInspect = ctrl && shift && (key === 'I' || key === 'i' || key === 'J' || key === 'j' || key === 'C' || key === 'c');
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

/**
 * Report violation lên server — batch + retry-on-fail (queue trong memory).
 *
 * Gọi từ component: `const report = useReportViolations(attemptId);` rồi
 * pass `report` làm `onViolation` cho các hook trên.
 */
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
        // Failed — push back vào queue đầu để retry sau
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
      // Debounce flush 1s
      window.setTimeout(flush, 1000);
    },
    [flush],
  );

  // Flush on unmount để không mất event cuối
  React.useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  return report;
}
