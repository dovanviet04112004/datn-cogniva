'use client';

import * as React from 'react';

import { emitTyping, useRealtimeEvent } from '@/lib/realtime-client';
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
    }, 500);
    return () => clearInterval(id);
  }, []);

  const names = Array.from(typers.values()).map((t) => t.name);

  if (names.length === 0) {
    return <div className="h-5 px-4" aria-hidden />;
  }

  return (
    <div
      className="text-muted-foreground flex h-5 items-center gap-2 px-4 text-[11px]"
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
      className="bg-muted-foreground/70 inline-block h-1 w-1 animate-bounce rounded-full"
      style={{ animationDelay: `${delay}ms`, animationDuration: '900ms' }}
    />
  );
}

function formatNames(names: string[]): string {
  if (names.length === 1) return `${names[0]} đang gõ…`;
  if (names.length === 2) return `${names[0]} và ${names[1]} đang gõ…`;
  if (names.length === 3) return `${names[0]}, ${names[1]} và ${names[2]} đang gõ…`;
  return `${names[0]}, ${names[1]} và ${names.length - 2} người khác đang gõ…`;
}

export function useEmitTyping(channelId: string) {
  const lastSentRef = React.useRef(0);
  const DEBOUNCE_MS = 800;

  return React.useCallback(() => {
    const now = Date.now();
    if (now - lastSentRef.current < DEBOUNCE_MS) return;
    lastSentRef.current = now;
    emitTyping(`private-channel-${channelId}`);
  }, [channelId]);
}
