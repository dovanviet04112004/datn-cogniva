/**
 * ChatPanel — sidebar chat realtime trong room.
 *
 * Initial load: GET /api/rooms/{id}/chat → 50 message gần nhất.
 * Subscribe `presence-room-{id}` qua Soketi → bind:
 *   - `chat:message`   : tin nhắn mới (text/AI placeholder/system)
 *   - `ai:streaming`   : delta từng token cho AI message (Phase 15)
 *   - `ai:complete`    : AI generation xong → lock final content
 *   - `ai:error`       : AI generation fail → đánh dấu message error
 *
 * Gửi:
 *   - Text thường: POST /api/rooms/{id}/chat
 *   - `@AI <câu hỏi>` ở đầu message: POST /api/rooms/{id}/ai-message
 *     Server insert AI placeholder + stream delta → client nhận qua Soketi.
 *
 * UX:
 *   - Auto-scroll xuống cuối khi có message mới (trừ khi user đã scroll lên).
 *   - Bubble AI có badge "AI Tutor" + caret nhấp nháy khi đang stream.
 *   - Enter để gửi, Shift+Enter xuống dòng.
 *   - Hint UI: "Gõ @AI để hỏi gia sư AI" hiển thị khi input rỗng.
 */
'use client';

import * as React from 'react';
import { Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { getPusherClient } from '@/lib/realtime-client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Trạng thái stream cho AI message — Phase 15. */
type AiStatus = 'streaming' | 'complete' | 'error';

type Msg = {
  id: string;
  userId: string;
  userName: string | null;
  userImage?: string | null;
  content: string;
  type: 'TEXT' | 'FILE' | 'AI' | 'SYSTEM';
  createdAt: string | Date;
  /** Chỉ có ở type='AI' — track stream state để UI biết khi nào ngừng caret. */
  aiStatus?: AiStatus;
};

type Props = {
  roomId: string;
  currentUserId: string;
};

/** Regex match `@AI` (case-insensitive) ở đầu string (sau optional whitespace). */
const AI_PREFIX = /^\s*@ai\b\s*/i;

export function ChatPanel({ roomId, currentUserId }: Props) {
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const isAtBottomRef = React.useRef(true);

  // Initial load
  React.useEffect(() => {
    fetch(`/api/rooms/${roomId}/chat`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { messages: Msg[] }) => setMessages(d.messages))
      .catch((err) => console.error('[chat] load fail:', err));
  }, [roomId]);

  // Subscribe Soketi — chat:message + ai:streaming/complete/error
  React.useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher) return;

    const channel = pusher.subscribe(`presence-room-${roomId}`);

    const onMessage = (data: Msg) => {
      setMessages((prev) => {
        // Trùng ID (server echo) → bỏ qua
        if (prev.some((m) => m.id === data.id)) return prev;
        return [
          ...prev,
          // AI message vừa đẻ ra → mark streaming
          data.type === 'AI' ? { ...data, aiStatus: 'streaming' as const } : data,
        ];
      });
    };

    const onAiStreaming = (data: { messageId: string; delta: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId
            ? { ...m, content: m.content + data.delta, aiStatus: 'streaming' }
            : m,
        ),
      );
    };

    const onAiComplete = (data: { messageId: string; content: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId
            ? { ...m, content: data.content, aiStatus: 'complete' }
            : m,
        ),
      );
    };

    const onAiError = (data: { messageId: string; error: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId ? { ...m, aiStatus: 'error' } : m,
        ),
      );
      toast.error(`AI lỗi: ${data.error}`);
    };

    channel.bind('chat:message', onMessage);
    channel.bind('ai:streaming', onAiStreaming);
    channel.bind('ai:complete', onAiComplete);
    channel.bind('ai:error', onAiError);

    return () => {
      channel.unbind('chat:message', onMessage);
      channel.unbind('ai:streaming', onAiStreaming);
      channel.unbind('ai:complete', onAiComplete);
      channel.unbind('ai:error', onAiError);
      // Note: KHÔNG unsubscribe channel — components khác (Pomodoro, Reactions)
      // có thể đang dùng. Pusher auto cleanup khi tab close.
    };
  }, [roomId]);

  // Auto-scroll xuống cuối khi có message mới (nếu user đang ở dưới).
  // Cần phụ thuộc cả content của AI message (đang grow theo stream) để scroll
  // theo từng token thay vì chỉ khi count thay đổi.
  React.useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Track xem user có ở bottom không (để quyết định auto-scroll)
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  const send = async () => {
    const content = input.trim();
    if (!content || sending) return;

    // Detect `@AI ...` prefix → route sang AI endpoint
    const aiMatch = content.match(AI_PREFIX);
    const isAiQuery = !!aiMatch;
    const aiQuery = isAiQuery ? content.replace(AI_PREFIX, '').trim() : '';

    if (isAiQuery && !aiQuery) {
      toast.warning('Hãy gõ câu hỏi sau @AI');
      return;
    }

    setSending(true);
    try {
      if (isAiQuery) {
        // 1. Trước hết gửi câu hỏi của user vào chat thường (để mọi người thấy)
        await fetch(`/api/rooms/${roomId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        // 2. Trigger AI — response stream qua Soketi, không cần await full
        const res = await fetch(`/api/rooms/${roomId}/ai-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: aiQuery }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? 'AI Tutor lỗi');
        }
      } else {
        const res = await fetch(`/api/rooms/${roomId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? 'Gửi tin nhắn thất bại');
        }
      }
      setInput('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const willTriggerAI = AI_PREFIX.test(input);

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto p-3 space-y-3"
      >
        {messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Chưa có tin nhắn. Hãy nói câu chào đầu tiên! <br />
            Gõ <code className="rounded bg-muted px-1">@AI &lt;câu hỏi&gt;</code> để hỏi gia sư AI.
          </p>
        ) : (
          messages.map((m) => (
            <MessageRow key={m.id} message={m} isOwn={m.userId === currentUserId} />
          ))
        )}
      </div>

      {/* Input */}
      <div className="border-t p-2">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Nhập tin nhắn... (gõ @AI để hỏi gia sư AI)"
            rows={2}
            maxLength={2000}
            disabled={sending}
            className="flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <Button
            onClick={send}
            disabled={sending || !input.trim()}
            size="icon"
            aria-label={willTriggerAI ? 'Hỏi AI' : 'Gửi'}
            title={willTriggerAI ? 'Hỏi AI Tutor' : 'Gửi tin nhắn'}
            variant={willTriggerAI ? 'default' : 'default'}
          >
            {willTriggerAI ? <Sparkles className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {willTriggerAI && (
          <p className="mt-1 text-[10px] text-primary">
            <Sparkles className="mr-0.5 inline h-3 w-3" />
            Sẽ gọi AI Tutor — cả phòng sẽ thấy câu trả lời stream realtime.
          </p>
        )}
      </div>
    </div>
  );
}

function MessageRow({ message, isOwn }: { message: Msg; isOwn: boolean }) {
  const name = message.userName ?? 'Anonymous';
  const time = new Date(message.createdAt).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (message.type === 'AI') {
    const isStreaming = message.aiStatus === 'streaming';
    const isError = message.aiStatus === 'error';
    return (
      <div
        className={cn(
          'rounded-md border p-2',
          isError ? 'border-destructive bg-destructive/5' : 'bg-primary/5',
        )}
      >
        <p className="flex items-center gap-1 text-[10px] font-medium uppercase text-primary">
          <Sparkles className="h-3 w-3" />
          AI Tutor · {time}
          {isStreaming && <span className="ml-1 text-muted-foreground">đang trả lời...</span>}
          {isError && <span className="ml-1 text-destructive">lỗi</span>}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm">
          {message.content || (isStreaming ? '...' : '[empty]')}
          {/* Caret nhấp nháy ở cuối khi đang stream */}
          {isStreaming && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-primary align-middle" />}
        </p>
      </div>
    );
  }

  if (message.type === 'SYSTEM') {
    return (
      <p className="text-center text-[10px] italic text-muted-foreground">{message.content}</p>
    );
  }

  return (
    <div className={cn('flex gap-2', isOwn && 'flex-row-reverse')}>
      <Avatar className="h-6 w-6 shrink-0">
        {message.userImage && <AvatarImage src={message.userImage} alt={name} />}
        <AvatarFallback className="text-[10px]">{name[0]?.toUpperCase() ?? '?'}</AvatarFallback>
      </Avatar>
      <div className={cn('flex max-w-[80%] flex-col', isOwn && 'items-end')}>
        <div className="flex items-baseline gap-2 text-[10px] text-muted-foreground">
          <span className="font-medium">{isOwn ? 'Bạn' : name}</span>
          <span>{time}</span>
        </div>
        <p
          className={cn(
            'mt-0.5 whitespace-pre-wrap rounded-md px-2 py-1 text-sm',
            isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted',
          )}
        >
          {message.content}
        </p>
      </div>
    </div>
  );
}
