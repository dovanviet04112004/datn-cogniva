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
import { Image as ImageIcon, Loader2, PencilLine, Send, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { type CitationData } from './citation';
import { DocPreviewPanel } from './doc-preview-panel';
import { MathCanvasDialog } from './math-canvas-dialog';
import { MessageBubble, type ChatRole } from './message-bubble';
import { VoiceInputButton } from './voice-input-button';

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
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showCanvas, setShowCanvas] = useState(false);
  // Inline doc preview — set khi user click citation badge
  const [docPreview, setDocPreview] = useState<CitationData | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { messages, input, setInput, handleSubmit, append, status, data } = useChat({
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

  /** Append text từ voice input — không replace, ghép vào cuối. */
  const appendVoice = (text: string) => {
    setInput((prev) => (prev.trim() ? prev + ' ' + text : text));
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length === 0) return;
    // Giới hạn 4 ảnh / 1 lần gửi
    setAttachments((prev) => [...prev, ...files].slice(0, 4));
    e.target.value = '';
  };

  /** Submit kèm attachments — chuyển File[] → FileList qua DataTransfer
   *  vì useChat expect FileList | Attachment[].
   *
   *  AI SDK v4 `handleSubmit` skip nếu input.trim() empty. Workaround:
   *  khi user chỉ gửi ảnh (không text), dùng `append()` trực tiếp với
   *  message placeholder để bypass logic check empty input. */
  const submitWithAttachments = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim().length === 0 && attachments.length === 0) return;
    let fileList: FileList | undefined;
    if (attachments.length > 0) {
      const dt = new DataTransfer();
      for (const f of attachments) dt.items.add(f);
      fileList = dt.files;
    }
    // Nhánh "chỉ có ảnh, không text" → append thay vì handleSubmit
    if (input.trim().length === 0 && fileList && fileList.length > 0) {
      append(
        { role: 'user', content: 'Phân tích nội dung trong ảnh.' },
        { experimental_attachments: fileList },
      );
      setAttachments([]);
      return;
    }
    // Có text (kèm hoặc không kèm ảnh) → handleSubmit chuẩn
    handleSubmit(e, { experimental_attachments: fileList });
    setAttachments([]);
  };

  return (
    <div className="flex h-full">
      {/* ── Chat column ───────────────────────────────────────── */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
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
                  onOpenDocPreview={setDocPreview}
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
          onSubmit={submitWithAttachments}
          className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-4"
        >
          {/* Preview attachments */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((f, i) => (
                <div
                  key={i}
                  className="relative h-16 w-16 overflow-hidden rounded-md border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black"
                    aria-label="Xóa ảnh"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Hỏi về tài liệu của bạn… (⌘/Ctrl + Enter để gửi)"
              disabled={isLoading}
              rows={1}
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
            <VoiceInputButton onTranscript={appendVoice} disabled={isLoading} />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={handleFilePick}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              aria-label="Đính kèm ảnh"
              title="Đính kèm ảnh"
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setShowCanvas(true)}
              disabled={isLoading}
              aria-label="Vẽ công thức"
              title="Vẽ công thức / sơ đồ"
            >
              <PencilLine className="h-4 w-4" />
            </Button>
            <Button
              type="submit"
              size="icon"
              disabled={
                isLoading || (input.trim().length === 0 && attachments.length === 0)
              }
              aria-label="Gửi"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>
      </div>
      </div>
      {/* ── End chat column ─────────────────────────────────── */}

      {/* ── Doc preview side panel (citation click) ──────────────────── */}
      {docPreview && (
        <div className="hidden h-full w-full max-w-[50%] shrink-0 md:block md:w-1/2">
          <DocPreviewPanel citation={docPreview} onClose={() => setDocPreview(null)} />
        </div>
      )}

      {/* ── Math canvas dialog ─────────────────────── */}
      <MathCanvasDialog
        open={showCanvas}
        onOpenChange={setShowCanvas}
        onSave={(file) => setAttachments((prev) => [...prev, file].slice(0, 4))}
      />
    </div>
  );
}
