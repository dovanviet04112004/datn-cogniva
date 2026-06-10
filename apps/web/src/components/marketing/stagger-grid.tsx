/**
 * StaggerGrid — wrap children, fade-in + slide-up từng item với delay tăng dần.
 *
 * Trigger qua IntersectionObserver:
 *   - Khi grid vào viewport (≥10%) → set `visible=true` → CSS animation chạy.
 *   - Mỗi child có `transition-delay: index × 100ms` qua inline style.
 *   - Chỉ chạy 1 lần (`unobserve` sau khi visible) — scroll lên scroll xuống
 *     không re-trigger.
 *
 * Children được wrap trong div inner để pass index-based style. CSS animation
 * dùng Tailwind opacity + translate-y với transition smooth.
 */
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type Props = {
  children: React.ReactNode;
  /** Class cho grid wrapper outer — vd "grid grid-cols-1 md:grid-cols-3 gap-4". */
  className?: string;
  /** Delay mỗi item (ms). Default 100. */
  staggerMs?: number;
};

export function StaggerGrid({ children, className, staggerMs = 100 }: Props) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Nếu user đã enable prefers-reduced-motion → skip animation, show ngay
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Wrap mỗi child với div delay riêng — index-based
  const wrapped = React.Children.map(children, (child, i) => (
    <div
      style={{ transitionDelay: visible ? `${i * staggerMs}ms` : '0ms' }}
      className={cn(
        'transition-all duration-700 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
      )}
    >
      {child}
    </div>
  ));

  return (
    <div ref={ref} className={className}>
      {wrapped}
    </div>
  );
}
