/**
 * UnreadContext — share unread map { channelId: count } cho channel list.
 *
 * Source:
 *   - Initial fetch /api/groups/[id]/unread khi mount
 *   - Sub presence-group-{groupId} event `message:new-in-channel` từ server
 *     (trigger ngay sau insert message, payload {channelId, authorId})
 *     → +1 nếu authorId !== me && channelId !== activeChannel
 *   - Khi user mở channel X → reset map[X] = 0 (POST /read endpoint cũng được
 *     fire bởi TextChannel — context chỉ optimistic local clear)
 *
 * Lý do tách context: GroupShell render channel list (Col 2) + active channel
 * page render messages. Cả 2 đều cần unread state → context tránh prop drill.
 */
'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

import { useRealtimeEvent } from '@/lib/realtime-client';

type UnreadCtx = {
  /** Map channelId → số message chưa đọc. */
  unread: Record<string, number>;
  /** Clear unread cho 1 channel (gọi khi user vào channel). */
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

  // Active channel = segment cuối khi pathname dạng /groups/[id]/[channelId]
  const activeChannelId = React.useMemo(() => {
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'groups' && parts[1] === groupId && parts[2]) {
      // Loại trừ /groups/[id]/settings
      return parts[2] === 'settings' ? null : parts[2];
    }
    return null;
  }, [pathname, groupId]);

  // Initial fetch
  React.useEffect(() => {
    fetch(`/api/groups/${groupId}/unread`)
      .then((r) => r.json())
      .then((d: { unread: Record<string, number> }) => {
        // Active channel coi như đã đọc — clear ngay
        const m = { ...d.unread };
        if (activeChannelId) delete m[activeChannelId];
        setUnread(m);
      })
      .catch(() => {});
    // chỉ fetch lần đầu, mọi update sau qua realtime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Khi user navigate vào channel → clear
  React.useEffect(() => {
    if (!activeChannelId) return;
    setUnread((prev) => {
      if (!prev[activeChannelId]) return prev;
      const m = { ...prev };
      delete m[activeChannelId];
      return m;
    });
  }, [activeChannelId]);

  // Subscribe presence-group → mọi message:new-in-channel sẽ tăng count
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
