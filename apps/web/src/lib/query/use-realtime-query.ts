'use client';

import * as React from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { useRealtimeEvent } from '@/lib/realtime-client';

export function useRealtimeSetData<TData, TEvent = unknown>(
  channel: string,
  event: string,
  key: QueryKey,
  updater: (prev: TData | undefined, payload: TEvent) => TData | undefined,
) {
  const qc = useQueryClient();
  const keyStr = JSON.stringify(key);
  const cb = React.useCallback(
    (payload: TEvent) => {
      qc.setQueryData<TData>(JSON.parse(keyStr) as QueryKey, (prev) => updater(prev, payload));
    },
    [qc, keyStr, updater],
  );
  useRealtimeEvent<TEvent>(channel, event, cb);
}

export function useRealtimeInvalidate(channel: string, event: string, keys: QueryKey[]) {
  const qc = useQueryClient();
  const keysStr = JSON.stringify(keys);
  const cb = React.useCallback(() => {
    const parsed = JSON.parse(keysStr) as QueryKey[];
    for (const k of parsed) qc.invalidateQueries({ queryKey: k });
  }, [qc, keysStr]);
  useRealtimeEvent(channel, event, cb);
}
