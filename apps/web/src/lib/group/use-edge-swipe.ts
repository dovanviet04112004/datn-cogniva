/**
 * useEdgeSwipe — V2 (2026-05-21).
 *
 * Hook detect swipe từ cạnh trái/phải màn hình → trigger callback. Dùng cho
 * mobile drawer pattern: vuốt từ mép trái mở channel list, vuốt từ mép phải
 * mở member list (Discord-style).
 *
 * Gating: chỉ trigger nếu touchstart nằm trong `EDGE_PX` từ cạnh.
 *
 * Trade-off: KHÔNG block native gestures (browser back swipe trên iOS) —
 * chỉ react khi user vuốt vào TRONG (gesture browser back là vuốt RA).
 */
'use client';

import * as React from 'react';

const EDGE_PX = 24; // dải pixel từ cạnh tính là "edge"
const MIN_DELTA = 50; // distance tối thiểu để được coi là swipe (không phải tap)

type Options = {
  onSwipeFromLeft?: () => void;
  onSwipeFromRight?: () => void;
  /** Skip nếu drawer đang mở để tránh re-trigger. */
  enabled?: boolean;
};

export function useEdgeSwipe({
  onSwipeFromLeft,
  onSwipeFromRight,
  enabled = true,
}: Options) {
  React.useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    // Skip nếu device không phải touch (desktop)
    if (!('ontouchstart' in window)) return;

    let startX = 0;
    let startY = 0;
    let edge: 'left' | 'right' | null = null;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      if (startX <= EDGE_PX) edge = 'left';
      else if (startX >= window.innerWidth - EDGE_PX) edge = 'right';
      else edge = null;
    };

    const onEnd = (e: TouchEvent) => {
      if (!edge) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      // Vuốt phải đáng kể + ít lệch dọc + đang ở edge trái → mở channels
      if (edge === 'left' && dx > MIN_DELTA && dy < MIN_DELTA) {
        onSwipeFromLeft?.();
      } else if (edge === 'right' && dx < -MIN_DELTA && dy < MIN_DELTA) {
        onSwipeFromRight?.();
      }
      edge = null;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [enabled, onSwipeFromLeft, onSwipeFromRight]);
}
