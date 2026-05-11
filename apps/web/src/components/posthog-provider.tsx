/**
 * PosthogProvider — wrap app để init posthog-js + capture pageview tự động.
 *
 * Mặc định posthog-js autoCapture click/input → đủ cho v1 analytics.
 * Track pageview thủ công qua Next.js navigation event (App Router không
 * có route-change event sẵn → dùng usePathname).
 *
 * No-op nếu thiếu NEXT_PUBLIC_POSTHOG_KEY (dev mode).
 */
'use client';

import * as React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com';

let inited = false;
function initOnce() {
  if (inited || !KEY || typeof window === 'undefined') return;
  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: false, // tự track qua usePathname để chính xác hơn
    persistence: 'localStorage',
    autocapture: true,
  });
  inited = true;
}

export function PosthogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();

  React.useEffect(() => {
    initOnce();
  }, []);

  // Track pageview khi pathname đổi
  React.useEffect(() => {
    if (!KEY) return;
    const url = pathname + (search?.toString() ? `?${search.toString()}` : '');
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, search]);

  return <>{children}</>;
}
