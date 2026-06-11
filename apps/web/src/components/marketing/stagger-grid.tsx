'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type Props = {
  children: React.ReactNode;
  className?: string;
  staggerMs?: number;
};

export function StaggerGrid({ children, className, staggerMs = 100 }: Props) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
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
