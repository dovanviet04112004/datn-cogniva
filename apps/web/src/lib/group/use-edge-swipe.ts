'use client';

import * as React from 'react';

const EDGE_PX = 24;
const MIN_DELTA = 50;

type Options = {
  onSwipeFromLeft?: () => void;
  onSwipeFromRight?: () => void;
  enabled?: boolean;
};

export function useEdgeSwipe({ onSwipeFromLeft, onSwipeFromRight, enabled = true }: Options) {
  React.useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
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
