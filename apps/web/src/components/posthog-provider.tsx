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
    capture_pageview: false,
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

  React.useEffect(() => {
    if (!KEY) return;
    const url = pathname + (search?.toString() ? `?${search.toString()}` : '');
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, search]);

  return <>{children}</>;
}
