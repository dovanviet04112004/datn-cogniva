/**
 * ChatInterface — main client component của trang chat.
 *
 * Trách nhiệm:
 *   - useChat hook của AI SDK để stream response từ /api/chat
 *   - Hiển thị message list (user + assistant) với streaming token-by-token
 *   - Composer ở dưới: textarea auto-grow, Cmd/Ctrl+Enter để gửi
 *   - Đọc citations từ message.annotations (server gửi qua dataStream)
 *   - Khi tạo conversation mới (no id ban đầu): server trả về conversationId
 *     trong dataStream → client navigate sang /chat/[id] sau khi stream xong
 *
 * Limitations Phase 2 v1:
 *   - Không có "regenerate" hoặc "edit message"
 *   - Không truyền workspaceId (retrieval scope = full user docs)
 *   - History scroll auto-bottom đơn giản, chưa virtualize
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChat, type Message as AIMessage } from '@ai-sdk/react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { type CitationData } from './citation';
import { MessageBubble, type ChatRole } from './message-bubble';

type Props = {
  /** undefined = chat mới; string = conversation đã có. */
  conversationId?: string;
  /** Initial messages khi load conversation cũ. */
  initialMessages?: AIMessage[];
};

/**
 * Lấy citations từ annotations của 1 message. Server gửi annotation kiểu
 * { type: 'citations', citations: [...] }.
 */
function getCitations(msg: AIMessage): CitationData[] {
  const annotations = (msg.annotations ?? []) as Array<{
    type?: string;
    citations?: CitationData[];
  }>;
  const citationAnnotation = annotations.find((a) => a?.type === 'citations');
  return citationAnnotation?.citations ?? [];
}

export function ChatInterface({ conversationId, initialMessages = [] }: Props) {
  const router = useRouter();
  const [createdConvId, setCreatedConvId] = useState<string | undefined>(conversationId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, input, setInput, handleSubmit, status, data } = useChat({
    api: '/api/chat',
    id: conversationId,
    initialMessages,
    body: { conversationId: conversationId ?? null },
    onError: (err) => toast.error(err.message ?? 'Chat lỗi — kiểm tra API key'),
  });

  // Đọc conversationId từ data stream (server gửi { type: 'meta', conversationId })
  useEffect(() => {
    if (createdConvId) return;
    const meta = (data ?? []).find(
      (d): d is { type: 'meta'; conversationId: string } =>
        typeof d === 'object' && d !== null && (d as { type?: string }).type === 'meta',
    );
    if (meta?.conversationId) setCreatedConvId(meta.conversationId);
  }, [data, createdConvId]);

  // Khi stream xong + có conversationId mới → navigate sang URL ổn định
  useEffect(() => {
    if (status === 'ready' && !conversationId && createdConvId) {
      router.replace(`/chat/${createdConvId}`);
    }
  }, [status, createdConvId, conversationId, router]);

  // Auto-scroll xuống cuối khi có message mới
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const isLoading = status === 'streaming' || status === 'submitted';

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter để gửi (Enter không gửi để cho phép newline)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const form = e.currentTarget.form;
      form?.requestSubmit();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Message list ───────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
          {messages.length === 0 ? (
            <Card className="border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Bắt đầu hội thoại</p>
              <p className="mt-1">
                Đặt câu hỏi về tài liệu bạn đã upload. Cogniva sẽ retrieve top-5 chunk
                liên quan rồi trả lời kèm citation.
              </p>
            </Card>
          ) : (
            messages.map((msg, idx) => (
              <MessageBubble
                key={msg.id}
                role={msg.role as ChatRole}
                content={msg.content}
                citations={getCitations(msg)}
                isStreaming={
                  isLoading && idx === messages.length - 1 && msg.role === 'assistant'
                }
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Composer ───────────────────────────────── */}
      <div className="border-t bg-background/80 backdrop-blur">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-3xl items-end gap-2 px-6 py-4"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Hỏi về tài liệu của bạn… (⌘/Ctrl + Enter để gửi)"
            disabled={isLoading}
            rows={1}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || input.trim().length === 0}
            aria-label="Gửi"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
