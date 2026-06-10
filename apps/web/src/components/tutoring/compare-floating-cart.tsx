/**
 * CompareFloatingCart — V4 T5 (2026-05-22).
 *
 * Floating bar bottom hiển thị số tutor user đã chọn so sánh + nút "So sánh
 * N gia sư" navigate /tutoring/compare?ids=a,b,c.
 *
 * Hiển thị khi cart ≥ 1 tutor. Listen `cogniva:compare-cart-change` event từ
 * TutorCard để re-render khi user toggle.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  COMPARE_CART_EVENT,
  readCompareCart,
  writeCompareCart,
} from './tutor-card';

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
        'fixed inset-x-0 bottom-4 z-30 mx-auto flex w-fit max-w-[calc(100vw-32px)] items-center gap-3 rounded-2xl border border-primary/30 bg-card/95 px-4 py-2.5 shadow-2xl backdrop-blur-md',
      )}
    >
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">
        {ids.length}
      </span>
      <span className="text-[13px] font-medium">
        {ids.length === 1 ? 'gia sư đã chọn' : 'gia sư đang so sánh'}
      </span>
      {ids.length >= 2 ? (
        // So sánh — primary qua <Button asChild> (tự có shadow-primary)
        <Button asChild size="sm">
          <Link href={`/tutoring/compare?ids=${ids.join(',')}`}>
            So sánh
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      ) : (
        <span className="text-[11px] text-muted-foreground">
          Thêm ≥ 2 để so sánh
        </span>
      )}
      <button
        type="button"
        onClick={clear}
        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
        aria-label="Xoá hết"
        title="Xoá hết"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
