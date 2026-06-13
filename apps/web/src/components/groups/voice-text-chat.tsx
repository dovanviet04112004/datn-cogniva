'use client';

import * as React from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useRealtimeEvent } from '@/lib/realtime-client';
import { useMe } from '@/lib/use-me';
import { cn } from '@/lib/utils';

type Message = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  content: string;
  type: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  pending?: boolean;
};

const AI_TUTOR_ID = 'system-ai-tutor';
const AI_REGEX = /(^|\s)@AI(\s|$|[?!.,])/i;

export function VoiceTextChat({
  channelId,
  currentUserId,
}: {
  channelId: string;
  currentUserId: string;
}) {
  const { data: me } = useMe();
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const isAtBottomRef = React.useRef(true);

  React.useEffect(() => {
    setLoading(true);
    fetch(`/api/channels/${channelId}/messages?limit=50`)
      .then((r) => r.json())
      .then((d: { messages: Message[] }) => setMessages(d.messages))
      .catch(() => toast.error('Không tải được tin nhắn'))
      .finally(() => setLoading(false));
  }, [channelId]);

  const onNew = React.useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);
  useRealtimeEvent<Message>(`private-channel-${channelId}`, 'message:new', onNew);

  React.useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  const send = async () => {
    const content = input.trim();
    if (!content) return;
    const isAi = AI_REGEX.test(content);
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: tempId,
      channelId,
      authorId: me?.id ?? currentUserId,
      authorName: me?.name ?? null,
      authorImage: me?.image ?? null,
      content,
      type: 'text',
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');

    try {
      const res = await fetch(`/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Gửi lỗi');
      }
      const data = (await res.json()) as { message: Message };
      const real = data.message;
      setMessages((prev) => [...prev.filter((m) => m.id !== tempId && m.id !== real.id), real]);

      if (isAi) {
        fetch(`/api/channels/${channelId}/ai-reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalMessageId: real.id,
            prompt: content,
          }),
        }).catch((err) => {
          toast.error(`AI lỗi: ${(err as Error).message}`);
        });
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(content);
      toast.error((err as Error).message);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const willTriggerAi = AI_REGEX.test(input);

  return (
    <div className="flex h-full flex-col">
      <div className="text-text-muted border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
        Lịch sử chat · lưu cố định
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-xs">
            Chưa có tin nhắn.
            <br />
            Gõ <code className="bg-muted rounded px-1">@AI &lt;câu hỏi&gt;</code> để hỏi AI Tutor.
          </p>
        ) : (
          messages.map((m) => (
            <MessageRow key={m.id} msg={m} isOwn={m.authorId === currentUserId} />
          ))
        )}
      </div>

      <div className="border-t p-2">
        <div className="flex gap-1.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Nhập tin nhắn... gõ @AI để hỏi"
            rows={2}
            maxLength={2000}
            className="bg-background focus-visible:ring-primary/30 flex-1 resize-none rounded-md border px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2"
          />
          <Button
            onClick={send}
            disabled={!input.trim()}
            size="icon"
            aria-label={willTriggerAi ? 'Hỏi AI' : 'Gửi'}
            title={willTriggerAi ? 'Sẽ trigger AI Tutor' : 'Enter để gửi'}
          >
            {willTriggerAi ? <Sparkles className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {willTriggerAi && (
          <p className="text-primary mt-1 text-[11px]">
            <Sparkles className="mr-0.5 inline h-3 w-3" />
            AI Tutor sẽ trả lời — cả phòng đều thấy.
          </p>
        )}
      </div>
    </div>
  );
}

function MessageRow({ msg, isOwn }: { msg: Message; isOwn: boolean }) {
  const name = msg.authorName ?? 'Anonymous';
  const time = new Date(msg.createdAt).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const isAi = msg.authorId === AI_TUTOR_ID;

  if (msg.deletedAt) {
    return (
      <p className="text-muted-foreground text-center text-[11px] italic">[tin nhắn đã xoá]</p>
    );
  }

  if (isAi) {
    return (
      <div className="border-primary/20 bg-primary/5 rounded-md border p-2">
        <p className="text-primary flex items-center gap-1 text-[11px] font-semibold uppercase">
          <Sparkles className="h-3 w-3" />
          AI Tutor · {time}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-2', isOwn && 'flex-row-reverse', msg.pending && 'opacity-55')}>
      <Avatar className="h-6 w-6 shrink-0">
        {msg.authorImage && <AvatarImage src={msg.authorImage} alt={name} />}
        <AvatarFallback className="text-[10px]">{name[0]?.toUpperCase() ?? '?'}</AvatarFallback>
      </Avatar>
      <div className={cn('flex max-w-[78%] flex-col', isOwn && 'items-end')}>
        <div className="text-muted-foreground flex items-baseline gap-2 text-[11px]">
          <span className="font-medium">{isOwn ? 'Bạn' : name}</span>
          <span>{time}</span>
          {msg.editedAt && <span className="italic">(đã sửa)</span>}
        </div>
        <p
          className={cn(
            'mt-0.5 whitespace-pre-wrap rounded-md px-2 py-1 text-sm',
            isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted',
          )}
        >
          {msg.content}
        </p>
      </div>
    </div>
  );
}
