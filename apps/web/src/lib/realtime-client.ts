'use client';

import * as React from 'react';
import { io, type Socket } from 'socket.io-client';

let _socket: Socket | null = null;

const subCounts = new Map<string, number>();

export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  if (_socket) return _socket;

  const url = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (!url) {
    console.warn('[realtime] NEXT_PUBLIC_REALTIME_URL chưa set — realtime tắt');
    return null;
  }

  _socket = io(url, {
    transports: ['websocket'],
    withCredentials: true,
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
  React.useLayoutEffect(() => {
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

type PresenceStatePayload = { channel: string; userIds: string[] };
type PresenceMemberPayload = { channel: string; userId: string };

export function useRealtimePresence(
  channel: string,
  cb: {
    onState: (userIds: string[]) => void;
    onJoin: (userId: string) => void;
    onLeave: (userId: string) => void;
  },
  enabled = true,
) {
  const ref = React.useRef(cb);
  React.useLayoutEffect(() => {
    ref.current = cb;
  });

  React.useEffect(() => {
    if (!enabled) return;
    const s = getSocket();
    if (!s) return;

    refSubscribe(channel);
    const onState = (p: PresenceStatePayload) => {
      if (p.channel === channel) ref.current.onState(p.userIds);
    };
    const onJoin = (p: PresenceMemberPayload) => {
      if (p.channel === channel) ref.current.onJoin(p.userId);
    };
    const onLeave = (p: PresenceMemberPayload) => {
      if (p.channel === channel) ref.current.onLeave(p.userId);
    };
    s.on('presence:state', onState);
    s.on('presence:join', onJoin);
    s.on('presence:leave', onLeave);

    return () => {
      s.off('presence:state', onState);
      s.off('presence:join', onJoin);
      s.off('presence:leave', onLeave);
      refUnsubscribe(channel);
    };
  }, [channel, enabled]);
}
