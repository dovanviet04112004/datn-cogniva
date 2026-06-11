import * as React from 'react';
import { io, type Socket } from 'socket.io-client';

import { getValidAccessToken } from './api';

let _socket: Socket | null = null;
const subCounts = new Map<string, number>();

export function getSocket(): Socket | null {
  if (_socket) return _socket;

  const url = process.env.EXPO_PUBLIC_REALTIME_URL;
  if (!url) {
    console.warn('[realtime] EXPO_PUBLIC_REALTIME_URL chưa set — realtime tắt');
    return null;
  }

  _socket = io(url, {
    transports: ['websocket'],
    auth: (cb) => {
      void getValidAccessToken().then((token) => cb({ token: token ?? '' }));
    },
  });

  _socket.on('connect', () => {
    for (const [channel, n] of subCounts) {
      if (n > 0) _socket!.emit('subscribe', channel);
    }
  });

  return _socket;
}

function refSubscribe(channel: string) {
  const s = getSocket();
  if (!s) return;
  const n = (subCounts.get(channel) ?? 0) + 1;
  subCounts.set(channel, n);
  if (n === 1) s.emit('subscribe', channel);
}

function refUnsubscribe(channel: string) {
  const s = getSocket();
  const n = (subCounts.get(channel) ?? 1) - 1;
  if (n <= 0) {
    subCounts.delete(channel);
    s?.emit('unsubscribe', channel);
  } else {
    subCounts.set(channel, n);
  }
}

export function useRealtimeEvent<T = unknown>(
  channel: string,
  event: string,
  handler: (data: T) => void,
  enabled = true,
) {
  const ref = React.useRef(handler);
  React.useEffect(() => {
    ref.current = handler;
  });

  React.useEffect(() => {
    if (!enabled) return;
    const s = getSocket();
    if (!s) return;

    refSubscribe(channel);
    const onEvt = (ch: string, data: T) => {
      if (ch === channel) ref.current(data);
    };
    s.on(event, onEvt);

    return () => {
      s.off(event, onEvt);
      refUnsubscribe(channel);
    };
  }, [channel, event, enabled]);
}
