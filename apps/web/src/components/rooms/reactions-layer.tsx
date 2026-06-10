/**
 * ReactionsLayer — emoji bay từ dưới lên khi user click ReactionPicker.
 *
 * Broadcast qua LiveKit data channel — không cần realtime gateway. Mỗi reaction
 * float trong 2s rồi tự cleanup.
 *
 * Position random horizontal 10-90% width để tránh chồng chéo.
 */
'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';

type Reaction = { id: string; emoji: string; xPercent: number };

/** Tên window event để CHÍNH người gửi cũng thấy emoji của mình bay. */
export const REACTION_SELF_EVENT = 'cogniva:reaction-self';

export function ReactionsLayer() {
  const room = useRoomContext();
  const [items, setItems] = React.useState<Reaction[]>([]);

  const addFloat = React.useCallback((emoji: string) => {
    const r: Reaction = {
      id: crypto.randomUUID(),
      emoji,
      xPercent: Math.random() * 80 + 10,
    };
    setItems((prev) => [...prev, r]);
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== r.id)), 2000);
  }, []);

  React.useEffect(() => {
    // Người KHÁC react → nhận qua LiveKit data channel.
    const handler = (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type === 'REACTION' && data.emoji) addFloat(data.emoji);
      } catch {
        /* ignore */
      }
    };
    room.on('dataReceived', handler);

    // CHÍNH MÌNH react → LiveKit KHÔNG gửi data về chính người phát, nên nghe
    // window event do ReactionPicker bắn để người gửi cũng thấy emoji của mình.
    const onSelf = (e: Event) => {
      const emoji = (e as CustomEvent<{ emoji: string }>).detail?.emoji;
      if (emoji) addFloat(emoji);
    };
    window.addEventListener(REACTION_SELF_EVENT, onSelf);

    return () => {
      room.off('dataReceived', handler);
      window.removeEventListener(REACTION_SELF_EVENT, onSelf);
    };
  }, [room, addFloat]);

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
