'use client';

import * as React from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useChatDock } from '@/components/dm/chat-dock';

type Props = {
  tutorUserId: string;
  variant?: 'default' | 'large';
};

export function ContactTutorButton({ tutorUserId, variant = 'default' }: Props) {
  const { openChat } = useChatDock();
  const [loading, setLoading] = React.useState(false);

  const onClick = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerUserId: tutorUserId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as {
        thread: { id: string; peer: { id: string; name: string | null; image: string | null } };
      };
      openChat({ threadId: data.thread.id, peer: data.thread.peer });
    } catch (err) {
      toast.error('Không tạo được DM: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={loading}
      size={variant === 'large' ? 'default' : 'sm'}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MessageSquare className="h-4 w-4" />
      )}
      Liên hệ qua tin nhắn
    </Button>
  );
}
