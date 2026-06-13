'use client';

import * as React from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { addCacheBridge, useRealtimeEvent } from '@/lib/realtime-client';

export function useRealtimeSetData<TData, TEvent = unknown>(
  channel: string,
  event: string,
  key: QueryKey,
  updater: (prev: TData | undefined, payload: TEvent) => TData | undefined,
) {
  const qc = useQueryClient();
  const keyStr = JSON.stringify(key);
  const updaterRef = React.useRef(updater);
  React.useLayoutEffect(() => {
    updaterRef.current = updater;
  });

  React.useEffect(() => {
    const run = (payload: unknown) => {
      qc.setQueryData<TData>(JSON.parse(keyStr) as QueryKey, (prev) =>
        updaterRef.current(prev, payload as TEvent),
      );
    };
    return addCacheBridge(channel, event, run);
  }, [channel, event, keyStr, qc]);
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
