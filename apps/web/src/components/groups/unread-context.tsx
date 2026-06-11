'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

import { useRealtimeEvent } from '@/lib/realtime-client';

type UnreadCtx = {
  unread: Record<string, number>;
  clear: (channelId: string) => void;
};

const Ctx = React.createContext<UnreadCtx>({ unread: {}, clear: () => {} });

export function useUnread() {
  return React.useContext(Ctx);
}

type Props = {
  groupId: string;
  currentUserId: string;
  children: React.ReactNode;
};

export function UnreadProvider({ groupId, currentUserId, children }: Props) {
  const [unread, setUnread] = React.useState<Record<string, number>>({});
  const pathname = usePathname();

  const activeChannelId = React.useMemo(() => {
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'groups' && parts[1] === groupId && parts[2]) {
      return parts[2] === 'settings' ? null : parts[2];
    }
    return null;
  }, [pathname, groupId]);

  React.useEffect(() => {
    fetch(`/api/groups/${groupId}/unread`)
      .then((r) => r.json())
      .then((d: { unread: Record<string, number> }) => {
        const m = { ...d.unread };
        if (activeChannelId) delete m[activeChannelId];
        setUnread(m);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  React.useEffect(() => {
    if (!activeChannelId) return;
    setUnread((prev) => {
      if (!prev[activeChannelId]) return prev;
      const m = { ...prev };
      delete m[activeChannelId];
      return m;
    });
  }, [activeChannelId]);

  const onMsg = React.useCallback(
    (data: { channelId: string; authorId: string }) => {
      if (data.authorId === currentUserId) return;
      if (data.channelId === activeChannelId) return;
      setUnread((prev) => ({
        ...prev,
        [data.channelId]: (prev[data.channelId] ?? 0) + 1,
      }));
    },
    [activeChannelId, currentUserId],
  );
  useRealtimeEvent(`presence-group-${groupId}`, 'message:new-in-channel', onMsg);

  const clear = React.useCallback((channelId: string) => {
    setUnread((prev) => {
      if (!prev[channelId]) return prev;
      const m = { ...prev };
      delete m[channelId];
      return m;
    });
  }, []);

  const value = React.useMemo(() => ({ unread, clear }), [unread, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
