'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useFloatingDockHost } from '@/components/app/floating-dock';
import { cn } from '@/lib/utils';

import { DmChat } from './dm-chat';

type DockPeer = { id: string; name: string | null; image: string | null };
type DockWindow = { threadId: string; peer: DockPeer; minimized: boolean };

type Ctx = {
  windows: DockWindow[];
  openChat: (w: { threadId: string; peer: DockPeer }) => void;
  closeChat: (threadId: string) => void;
  toggleMinimize: (threadId: string) => void;
  currentUserId: string;
};

const ChatDockContext = React.createContext<Ctx | null>(null);

const LS_KEY = 'cogniva.chatdock';
const MAX_OPEN = 3;

export function ChatDockProvider({
  currentUserId,
  children,
}: {
  currentUserId: string;
  children: React.ReactNode;
}) {
  const [windows, setWindows] = React.useState<DockWindow[]>([]);
  const hydrated = React.useRef(false);

  React.useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DockWindow[];
        if (Array.isArray(parsed)) setWindows(parsed.slice(0, MAX_OPEN));
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(windows));
    } catch {}
  }, [windows]);

  const openChat: Ctx['openChat'] = React.useCallback(({ threadId, peer }) => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.threadId === threadId);
      if (existing) {
        return [
          { threadId, peer, minimized: false },
          ...prev.filter((w) => w.threadId !== threadId),
        ];
      }
      const next = [{ threadId, peer, minimized: false }, ...prev];
      return next.slice(0, MAX_OPEN);
    });
  }, []);

  const closeChat: Ctx['closeChat'] = React.useCallback((threadId) => {
    setWindows((prev) => prev.filter((w) => w.threadId !== threadId));
  }, []);

  const toggleMinimize: Ctx['toggleMinimize'] = React.useCallback((threadId) => {
    setWindows((prev) =>
      prev.map((w) => (w.threadId === threadId ? { ...w, minimized: !w.minimized } : w)),
    );
  }, []);

  return (
    <ChatDockContext.Provider
      value={{ windows, openChat, closeChat, toggleMinimize, currentUserId }}
    >
      {children}
      <ChatDock />
    </ChatDockContext.Provider>
  );
}

export function useChatDock(): Ctx {
  const ctx = React.useContext(ChatDockContext);
  if (!ctx) throw new Error('useChatDock phải dùng trong <ChatDockProvider>');
  return ctx;
}

function ChatDock() {
  const { windows, closeChat, toggleMinimize, currentUserId } = useChatDock();
  const host = useFloatingDockHost();
  if (windows.length === 0) return null;

  const content = (
    <>
      {windows.map((w) =>
        w.minimized ? (
          <button
            key={w.threadId}
            type="button"
            onClick={() => toggleMinimize(w.threadId)}
            className="border-divider bg-card shadow-elevated pointer-events-auto mb-3 flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 transition-transform hover:-translate-y-0.5"
          >
            <Avatar className="h-8 w-8">
              <AvatarImage src={w.peer.image ?? undefined} />
              <AvatarFallback className="text-xs">
                {(w.peer.name ?? 'U')[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="max-w-[7rem] truncate text-xs font-medium">
              {w.peer.name ?? 'Chat'}
            </span>
            <MessageSquare className="text-muted-foreground h-3.5 w-3.5" />
          </button>
        ) : (
          <div
            key={w.threadId}
            className={cn(
              'pointer-events-auto flex h-[26rem] w-80 flex-col overflow-hidden',
              'border-divider bg-background shadow-elevated rounded-t-2xl border',
            )}
          >
            <DmChat
              threadId={w.threadId}
              peer={w.peer}
              currentUserId={currentUserId}
              compact
              onMinimize={() => toggleMinimize(w.threadId)}
              onClose={() => closeChat(w.threadId)}
            />
          </div>
        ),
      )}
    </>
  );

  if (host) return createPortal(content, host);
  return (
    <div className="pointer-events-none fixed bottom-3 right-4 z-40 flex flex-row-reverse items-end gap-3">
      {content}
    </div>
  );
}
