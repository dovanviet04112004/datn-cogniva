/**
 * PresenceContext — track online users + their custom status realtime.
 *
 * Pattern qua realtime presence-group-{id} channel:
 *   - presence:state → load members → online set
 *   - presence:join / presence:leave → online set update
 *   - V2 G3: status:change broadcast event → cập nhật status map
 *
 * Distinction "online" vs "status":
 *   - `online` = đang có WS connection (Socket.IO presence)
 *   - `status` = self-declared label (online/idle/dnd/invisible)
 *   - User online + status='dnd' → render red dot, vẫn coi là "ở đây"
 *   - User offline (WS off) → render gray dot bất kể status DB là gì
 *
 * Realtime auth `/api/realtime/auth` đã handle channel này.
 */
'use client';

import * as React from 'react';

import { useRealtimeEvent, useRealtimePresence } from '@/lib/realtime-client';

export type MemberStatus = 'online' | 'idle' | 'dnd' | 'offline' | 'invisible';

type StatusInfo = {
  status: MemberStatus;
  statusText?: string | null;
  statusEmoji?: string | null;
};

type PresenceCtx = {
  /** Set userIds đang online trong group này (WS active). */
  online: Set<string>;
  /** Map userId → status info (text + emoji + 4-mode). */
  statusMap: Map<string, StatusInfo>;
  /** Set initial status từ API fetch (members list). */
  setInitialStatus: (entries: Array<{ userId: string } & StatusInfo>) => void;
  /** Connecting/connected state cho UI. */
  ready: boolean;
};

const Ctx = React.createContext<PresenceCtx>({
  online: new Set(),
  statusMap: new Map(),
  setInitialStatus: () => undefined,
  ready: false,
});

export function usePresence() {
  return React.useContext(Ctx);
}

export function PresenceProvider({
  groupId,
  children,
}: {
  groupId: string;
  children: React.ReactNode;
}) {
  const [online, setOnline] = React.useState<Set<string>>(new Set());
  const [statusMap, setStatusMap] = React.useState<Map<string, StatusInfo>>(
    new Map(),
  );
  const [ready, setReady] = React.useState(false);

  const setInitialStatus = React.useCallback(
    (entries: Array<{ userId: string } & StatusInfo>) => {
      setStatusMap((prev) => {
        const next = new Map(prev);
        for (const e of entries) {
          // Chỉ overwrite nếu chưa có (giữ realtime updates đã nhận)
          if (!next.has(e.userId)) {
            next.set(e.userId, {
              status: e.status,
              statusText: e.statusText,
              statusEmoji: e.statusEmoji,
            });
          }
        }
        return next;
      });
    },
    [],
  );

  const groupChannel = `presence-group-${groupId}`;

  // Presence: online = đang có WS connection tới channel này (gateway ref-count).
  //   - presence:state (snapshot lúc vào) → set toàn bộ online + ready
  //   - presence:join / presence:leave → cập nhật từng user
  useRealtimePresence(groupChannel, {
    onState: (ids) => {
      setOnline(new Set(ids));
      setReady(true);
    },
    onJoin: (id) =>
      setOnline((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      }),
    onLeave: (id) =>
      setOnline((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
  });

  // V2 G3: status:change broadcast từ /api/user/status PUT
  useRealtimeEvent<{
    userId?: string;
    status?: MemberStatus;
    statusText?: string | null;
    statusEmoji?: string | null;
  }>(groupChannel, 'status:change', (data) => {
    if (!data?.userId || !data.status) return;
    setStatusMap((prev) => {
      const next = new Map(prev);
      next.set(data.userId!, {
        status: data.status!,
        statusText: data.statusText,
        statusEmoji: data.statusEmoji,
      });
      return next;
    });
  });

  const value = React.useMemo(
    () => ({ online, statusMap, setInitialStatus, ready }),
    [online, statusMap, setInitialStatus, ready],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
