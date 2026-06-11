'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { purgeQueryCache } from '@/lib/query/idb-persister';

export const ACTIVE_USER_KEY = 'cogniva-cache-user';

export function CacheUserGuard({ userId }: { userId: string }) {
  const qc = useQueryClient();

  React.useEffect(() => {
    if (!userId) return;
    const prev = localStorage.getItem(ACTIVE_USER_KEY);
    if (prev !== userId) {
      if (prev) void purgeQueryCache(qc);
      localStorage.setItem(ACTIVE_USER_KEY, userId);
    }
  }, [userId, qc]);

  return null;
}
