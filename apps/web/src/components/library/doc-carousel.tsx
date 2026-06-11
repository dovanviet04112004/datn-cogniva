'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { DocCard, type DocCardData } from './doc-card';

export function DocCarousel({ docs }: { docs: DocCardData[] }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = React.useState(false);
  const [canRight, setCanRight] = React.useState(false);
  const drag = React.useRef({
    down: false,
    startX: 0,
    startScroll: 0,
    moved: false,
    pointerId: -1,
  });

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  React.useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, docs.length]);

  const scrollByDir = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType === 'touch' || e.button !== 0) return;
    drag.current = {
      down: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
      pointerId: e.pointerId,
    };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || !drag.current.down) return;
    const dx = e.clientX - drag.current.startX;
    if (!drag.current.moved && Math.abs(dx) < 6) return;
    drag.current.moved = true;
    el.scrollLeft = drag.current.startScroll - dx;
  };
  const endDrag = (e: React.PointerEvent) => {
    const el = ref.current;
    if (el && drag.current.pointerId !== -1) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
    }
    drag.current.down = false;
    drag.current.pointerId = -1;
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  };

  const arrowClass =
    'absolute top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full border border-divider bg-card p-1.5 shadow-elevated transition-colors hover:bg-muted';

  return (
    <div className="relative">
      {canLeft && (
        <button
          type="button"
          onClick={() => scrollByDir(-1)}
          aria-label="Cuộn trái"
          className={`${arrowClass} left-1`}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      <div
        ref={ref}
        onScroll={update}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onDragStart={(e) => e.preventDefault()}
        className="scrollbar-hide flex cursor-grab touch-pan-x select-none gap-3 overflow-x-auto pb-1 active:cursor-grabbing"
      >
        {docs.map((d) => (
          <div key={d.id} className="w-52 shrink-0">
            <DocCard doc={d} />
          </div>
        ))}
      </div>

      {canRight && (
        <button
          type="button"
          onClick={() => scrollByDir(1)}
          aria-label="Cuộn phải"
          className={`${arrowClass} right-1`}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
