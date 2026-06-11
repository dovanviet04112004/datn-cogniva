/**
 * Realtime client cho mobile (Expo RN) — Socket.IO, song song với web nhưng auth
 * bằng BEARER token (mobile không có cookie).
 *
 * `socket.io-client` chạy native trên React Native (dùng WebSocket của RN, không cần DOM).
 * Hook `useRealtimeEvent` GIỮ cùng chữ ký với web (`apps/web/src/lib/realtime-client.ts`)
 * và dùng chung hằng số channel/event ở `@cogniva/shared/realtime` → code màn hình share được.
 *
 * Auth: gateway nhận `auth.token` = accessToken JWT (ES256) ở handshake và verify
 * CỤC BỘ bằng JWKS (/api/auth/jwks). Token sống 15' → mỗi lần (re)connect phải đọc
 * lại async qua getValidAccessToken (tự refresh nếu sắp hết hạn) — socket sống qua
 * 15' rồi rớt mạng thì reconnect vẫn có token hợp lệ.
 */
import * as React from 'react';
import { io, type Socket } from 'socket.io-client';

import { getValidAccessToken } from './api';

let _socket: Socket | null = null;
const subCounts = new Map<string, number>();

/** Socket.IO client singleton. Trả null nếu chưa cấu hình EXPO_PUBLIC_REALTIME_URL. */
export function getSocket(): Socket | null {
  if (_socket) return _socket;

  const url = process.env.EXPO_PUBLIC_REALTIME_URL;
  if (!url) {
    console.warn('[realtime] EXPO_PUBLIC_REALTIME_URL chưa set — realtime tắt');
    return null;
  }

  _socket = io(url, {
    transports: ['websocket'],
    // Callback async chạy MỖI lần connect/reconnect — không bake token cũ vào
    // handshake; hết hạn thì getValidAccessToken refresh trước khi nối.
    auth: (cb) => {
      void getValidAccessToken().then((token) => cb({ token: token ?? '' }));
    },
  });

  // Reconnect → re-subscribe mọi channel đang active.
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

/**
 * Hook: subscribe channel + lắng nghe 1 event + auto cleanup. Latest-ref handler →
 * khỏi useCallback. Cùng chữ ký với web.
 *
 * @param enabled false → không subscribe.
 */
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
