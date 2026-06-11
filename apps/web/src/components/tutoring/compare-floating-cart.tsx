'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { COMPARE_CART_EVENT, readCompareCart, writeCompareCart } from './tutor-card';

export function CompareFloatingCart() {
  const [ids, setIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    const sync = () => setIds(readCompareCart());
    sync();
    window.addEventListener(COMPARE_CART_EVENT, sync);
    return () => window.removeEventListener(COMPARE_CART_EVENT, sync);
  }, []);

  if (ids.length === 0) return null;

  const clear = () => writeCompareCart([]);

  return (
    <div
      className={cn(
        'border-primary/30 bg-card/95 fixed inset-x-0 bottom-4 z-30 mx-auto flex w-fit max-w-[calc(100vw-32px)] items-center gap-3 rounded-2xl border px-4 py-2.5 shadow-2xl backdrop-blur-md',
      )}
    >
      <span className="bg-primary text-primary-foreground inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold">
        {ids.length}
      </span>
      <span className="text-[13px] font-medium">
        {ids.length === 1 ? 'gia sư đã chọn' : 'gia sư đang so sánh'}
      </span>
      {ids.length >= 2 ? (
        <Button asChild size="sm">
          <Link href={`/tutoring/compare?ids=${ids.join(',')}`}>
            So sánh
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      ) : (
        <span className="text-muted-foreground text-[11px]">Thêm ≥ 2 để so sánh</span>
      )}
      <button
        type="button"
        onClick={clear}
        className="text-muted-foreground hover:bg-muted hover:text-destructive ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full"
        aria-label="Xoá hết"
        title="Xoá hết"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
