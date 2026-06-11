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
  online: Set<string>;
  statusMap: Map<string, StatusInfo>;
  setInitialStatus: (entries: Array<{ userId: string } & StatusInfo>) => void;
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
  const [statusMap, setStatusMap] = React.useState<Map<string, StatusInfo>>(new Map());
  const [ready, setReady] = React.useState(false);

  const setInitialStatus = React.useCallback((entries: Array<{ userId: string } & StatusInfo>) => {
    setStatusMap((prev) => {
      const next = new Map(prev);
      for (const e of entries) {
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
  }, []);

  const groupChannel = `presence-group-${groupId}`;

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
