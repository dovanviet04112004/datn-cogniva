/**
 * TypingIndicator — V2 Quick Win 3 (study-group-v2.md).
 *
 * Hiển thị "X đang gõ…" footer dưới message list khi có user khác trong channel
 * đang nhập tin nhắn. Subscribe realtime (Socket.IO) `private-channel-{cid}` event `user:typing`.
 *
 * Logic:
 *   - Mỗi event chứa `{ userId, name, expiresAt }`. Lưu map userId → expiresAt.
 *   - Render names list (max 3), nếu hơn 3 thì "X, Y, Z và N người khác".
 *   - Self-event filter ở client (server không bỏ self để giữ logic đơn giản).
 *   - Tick 1s expire user khỏi map khi `expiresAt < now`.
 *
 * Empty (0 user typing) → render placeholder height=20px tránh layout shift.
 */
'use client';

import * as React from 'react';

import { useRealtimeEvent } from '@/lib/realtime-client';
import { useMe } from '@/lib/use-me';

type TypingEvent = {
  userId: string;
  name: string;
  image: string | null;
  expiresAt: number;
};

export function TypingIndicator({ channelId }: { channelId: string }) {
  const { data: me } = useMe();
  const selfId = me?.id ?? null;
  const [typers, setTypers] = React.useState<Map<string, TypingEvent>>(new Map());

  useRealtimeEvent<TypingEvent>(
    `private-channel-${channelId}`,
    'user:typing',
    React.useCallback(
      (data: TypingEvent) => {
        if (!data?.userId || data.userId === selfId) return;
        setTypers((prev) => {
          const next = new Map(prev);
          next.set(data.userId, data);
          return next;
        });
      },
      [selfId],
    ),
  );

  // Expire tick 1s
  React.useEffect(() => {
    const id = setInterval(() => {
      setTypers((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [k, v] of next) {
          if (v.expiresAt < now) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const names = Array.from(typers.values()).map((t) => t.name);

  // Placeholder height — tránh chat list nhảy lên-xuống khi user start/stop typing
  if (names.length === 0) {
    return <div className="h-5 px-4" aria-hidden />;
  }

  return (
    <div
      className="flex h-5 items-center gap-2 px-4 text-[11px] text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-0.5">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </span>
      <span className="truncate">{formatNames(names)}</span>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block h-1 w-1 animate-bounce rounded-full bg-muted-foreground/70"
      style={{ animationDelay: `${delay}ms`, animationDuration: '900ms' }}
    />
  );
}

function formatNames(names: string[]): string {
  if (names.length === 1) return `${names[0]} đang gõ…`;
  if (names.length === 2) return `${names[0]} và ${names[1]} đang gõ…`;
  if (names.length === 3)
    return `${names[0]}, ${names[1]} và ${names[2]} đang gõ…`;
  return `${names[0]}, ${names[1]} và ${names.length - 2} người khác đang gõ…`;
}

/**
 * Hook tiện ích cho composer — debounce broadcast typing event sau 1s
 * input changes. Return `notifyTyping()` để composer gọi mỗi keystroke.
 */
export function useEmitTyping(groupId: string, channelId: string) {
  const lastSentRef = React.useRef(0);
  const DEBOUNCE_MS = 3_000;

  return React.useCallback(() => {
    const now = Date.now();
    if (now - lastSentRef.current < DEBOUNCE_MS) return;
    lastSentRef.current = now;
    // Fire-and-forget — không block UI
    fetch(`/api/groups/${groupId}/channels/${channelId}/typing`, {
      method: 'POST',
    }).catch(() => {
      /* Silent — typing không quan trọng đủ */
    });
  }, [groupId, channelId]);
}
