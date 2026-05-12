/**
 * ReactionsLayer — emoji bay từ dưới lên khi user click ReactionPicker.
 *
 * Broadcast qua LiveKit data channel — không cần Soketi. Mỗi reaction
 * float trong 2s rồi tự cleanup.
 *
 * Position random horizontal 10-90% width để tránh chồng chéo.
 */
'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';

type Reaction = { id: string; emoji: string; xPercent: number };

export function ReactionsLayer() {
  const room = useRoomContext();
  const [items, setItems] = React.useState<Reaction[]>([]);

  React.useEffect(() => {
    const handler = (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type !== 'REACTION') return;
        const r: Reaction = {
          id: crypto.randomUUID(),
          emoji: data.emoji,
          xPercent: Math.random() * 80 + 10,
        };
        setItems((prev) => [...prev, r]);
        setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== r.id)), 2000);
      } catch {
        /* ignore */
      }
    };
    room.on('dataReceived', handler);
    return () => { room.off('dataReceived', handler); };
  }, [room]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((r) => (
        <span
          key={r.id}
          className="absolute bottom-20 animate-float-up text-4xl"
          style={{ left: `${r.xPercent}%` }}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
