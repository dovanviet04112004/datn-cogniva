/**
 * Pusher (Soketi) client helper — dùng trong React component để subscribe
 * realtime event (chat, presence, live exam broadcast…).
 *
 * Singleton pattern: 1 connection cho cả app, không tạo lại mỗi component.
 * Khi user logout hoặc đóng tab, browser tự đóng WS.
 *
 * SSR safety: chỉ init khi `typeof window !== 'undefined'`. Server-side
 * import file này sẽ throw có ý nếu cố `getPusherClient()`.
 */
'use client';

import Pusher from 'pusher-js';

let _client: Pusher | null = null;

/**
 * Lấy Pusher client singleton — gọi từ React hook hoặc useEffect.
 * Trả null nếu chạy server-side (an toàn cho component hybrid).
 */
export function getPusherClient(): Pusher | null {
  if (typeof window === 'undefined') return null;
  if (_client) return _client;

  const key = process.env.NEXT_PUBLIC_SOKETI_KEY;
  const host = process.env.NEXT_PUBLIC_SOKETI_HOST;
  if (!key || !host) {
    console.warn('[soketi] env chưa cấu hình — realtime sẽ không hoạt động');
    return null;
  }

  const isLocal = host === 'localhost' || host.startsWith('127.');
  _client = new Pusher(key, {
    wsHost: host,
    wsPort: isLocal ? 6001 : 443,
    wssPort: isLocal ? 6001 : 443,
    forceTLS: !isLocal,
    cluster: '',
    enabledTransports: isLocal ? ['ws'] : ['ws', 'wss'],
    // Auth endpoint cho presence/private channel — implement Phase 14
    authEndpoint: '/api/realtime/auth',
  });

  return _client;
}

/**
 * Hook tiện ích — subscribe channel + bind event + auto cleanup.
 *
 * @example
 * useRealtimeEvent(`presence-room-${roomId}`, 'chat:message', (data) => {
 *   setMessages(prev => [...prev, data]);
 * });
 */
import { useEffect } from 'react';

export function useRealtimeEvent<T = unknown>(
  channel: string,
  event: string,
  handler: (data: T) => void,
) {
  useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher) return;

    const ch = pusher.subscribe(channel);
    ch.bind(event, handler);
    return () => {
      ch.unbind(event, handler);
      // Note: không unsubscribe channel để các listener khác trong app
      // vẫn nhận event. Pusher tự cleanup khi tab đóng.
    };
  }, [channel, event, handler]);
}
