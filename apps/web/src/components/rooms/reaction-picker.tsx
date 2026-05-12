/**
 * ReactionPicker — popover chọn emoji react. Click → publish REACTION qua
 * LiveKit data channel → ReactionsLayer (mọi participant) render float.
 *
 * Set emoji giới hạn để tránh keyboard chiếm chỗ. Customize sau nếu cần.
 */
'use client';

import * as React from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Smile } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const EMOJIS = ['👍', '👏', '❤️', '😂', '😮', '🎉', '🔥', '🙏', '💯', '😴'];

export function ReactionPicker() {
  const { localParticipant } = useLocalParticipant();
  const [open, setOpen] = React.useState(false);

  const send = (emoji: string) => {
    localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: 'REACTION', emoji })),
      { reliable: false },  // unreliable OK cho reaction (mất 1-2 OK)
    );
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="React">
          <Smile className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="grid grid-cols-5 gap-1">
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => send(e)}
              className="rounded-md p-2 text-xl transition-transform hover:scale-125 hover:bg-muted"
              aria-label={`React ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
