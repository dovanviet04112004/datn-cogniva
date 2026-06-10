/**
 * Realtime client helper — Socket.IO (thay realtime cũ). Dùng trong React component
 * để nhận event realtime (chat, presence, voice, recording, notification…).
 *
 * Singleton: 1 connection WS cho cả app. Auth bằng cookie (web, gửi tự động nhờ
 * `withCredentials`) → gateway verify session qua Next. Transport WS-only.
 *
 * Mô hình channel = "room" của Socket.IO:
 *   - Component `useRealtimeEvent(channel, event, h)` → ref-count subscribe channel +
 *     lắng nghe `event`, LỌC theo channel (arg #1 server gửi kèm) vì tên event là global.
 *   - Ref-count theo channel: nhiều component sub cùng channel → chỉ gửi `subscribe` 1 lần,
 *     `unsubscribe` khi component cuối unmount → presence join/leave đúng.
 *   - Reconnect: server mất room state khi rớt → tự `subscribe` lại mọi channel đang active.
 *
 * SSR-safe: trả null server-side.
 */
'use client';

import * as React from 'react';
import { io, type Socket } from 'socket.io-client';

let _socket: Socket | null = null;

/** Đếm số subscriber còn sống theo channel (client-side ref-count). */
const subCounts = new Map<string, number>();

/** Lấy Socket.IO client singleton. Trả null nếu SSR hoặc thiếu cấu hình. */
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
    withCredentials: true, // gửi cookie để gateway verify session qua Next
  });

  // Reconnect: server đã mất room → re-subscribe mọi channel đang active.
  _socket.on('connect', () => {
    for (const [channel, n] of subCounts) {
      if (n > 0) _socket!.emit('subscribe', channel);
    }
  });

  return _socket;
}

/** Tăng ref + gửi `subscribe` khi 0→1. */
function refSubscribe(channel: string) {
  const s = getSocket();
  if (!s) return;
  const n = (subCounts.get(channel) ?? 0) + 1;
  subCounts.set(channel, n);
  if (n === 1) s.emit('subscribe', channel);
}

/** Giảm ref + gửi `unsubscribe` khi 1→0. */
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

/**
 * Hook: subscribe channel + lắng nghe 1 event + auto cleanup.
 *
 * GIỮ chữ ký cũ `(channel, event, handler)`. Dùng latest-ref cho handler → KHÔNG cần
 * `useCallback`, effect chỉ chạy lại khi đổi channel/event/enabled.
 *
 * @param enabled false → không subscribe (cho component subscribe có điều kiện).
 *
 * @example
 * useRealtimeEvent<Msg>(`presence-room-${roomId}`, 'chat:message', (m) => setMessages(p => [...p, m]));
 */
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
    // Server gửi (channel, data) — lọc đúng channel vì 1 socket join nhiều room.
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

/** Payload presence (khớp `@cogniva/shared/realtime` zPresenceState/zPresenceMember). */
type PresenceStatePayload = { channel: string; userIds: string[] };
type PresenceMemberPayload = { channel: string; userId: string };

/**
 * Hook presence — thay cơ chế member built-in của realtime cũ.
 *
 * Subscribe presence channel + nhận:
 *   - `presence:state` (snapshot userIds lúc vào) → onState
 *   - `presence:join` / `presence:leave` (1 user vào/rời) → onJoin / onLeave
 *
 * Latest-ref cho callbacks → khỏi useCallback ở caller.
 */
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
