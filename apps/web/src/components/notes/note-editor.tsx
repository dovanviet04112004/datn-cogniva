/**
 * NoteEditor — TipTap rich editor + autosave + AI inline completion (Tab).
 *
 * Tính năng:
 *   - StarterKit (bold/italic/heading 1-3/bullet/ordered/code/blockquote/HR)
 *   - Placeholder khi rỗng
 *   - Autosave: debounce 1.2s sau mỗi change → PATCH /api/notes/[id]
 *   - AI complete: Tab khi cursor cuối paragraph → fetch /complete → insert
 *
 * Trade-off:
 *   - Plain text Tab → insert tab thường. Đè Tab để gọi AI khi paragraph
 *     không rỗng + cursor cuối → trade-off chấp nhận cho Phase 7 v1.
 *   - Không stream completion (delay ~1-3s); Phase 8 SSE.
 */
'use client';

import * as React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

type Props = {
  noteId: string;
  initialTitle: string;
  initialContent: string;
};

/** Debounce hook đơn giản — gọi cb sau khoảng tĩnh `delay` ms. */
function useDebouncedCallback<T extends (...args: never[]) => void>(
  cb: T,
  delay: number,
) {
  const timer = React.useRef<NodeJS.Timeout | null>(null);
  const cbRef = React.useRef(cb);
  React.useEffect(() => {
    cbRef.current = cb;
  }, [cb]);
  return React.useCallback(
    (...args: Parameters<T>) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => cbRef.current(...args), delay);
    },
    [delay],
  );
}

export function NoteEditor({ noteId, initialTitle, initialContent }: Props) {
  const [title, setTitle] = React.useState(initialTitle);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [completing, setCompleting] = React.useState(false);

  const save = React.useCallback(
    async (next: { title?: string; content?: string }) => {
      try {
        const res = await fetch(`/api/notes/${noteId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        setSavedAt(new Date());
      } catch (err) {
        toast.error('Lưu thất bại: ' + (err as Error).message);
      }
    },
    [noteId],
  );

  const debouncedSave = useDebouncedCallback(save, 1200);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Viết note ở đây... (Tab cuối câu để AI gợi ý)',
      }),
    ],
    content: initialContent || '<p></p>',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[300px]',
      },
    },
    onUpdate: ({ editor }) => {
      debouncedSave({ content: editor.getHTML() });
    },
  });

  // AI complete khi user bấm Tab cuối paragraph
  const handleComplete = React.useCallback(async () => {
    if (!editor || completing) return;
    // Lấy ~500 ký tự text gần cursor
    const { from } = editor.state.selection;
    const before = editor.state.doc.textBetween(0, from, '\n');
    if (before.trim().length < 20) {
      toast.message('Viết thêm vài câu để AI gợi ý');
      return;
    }
    setCompleting(true);
    try {
      const res = await fetch('/api/notes/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: before.slice(-500) }),
      });
      const data = (await res.json()) as { completion?: string };
      const completion = (data.completion ?? '').trim();
      if (!completion) {
        toast.message('AI không gợi ý được, thử thêm context');
      } else {
        // Chèn 1 space + completion ngay tại cursor (giữ format hiện tại)
        editor.chain().focus().insertContent(' ' + completion).run();
      }
    } catch (err) {
      toast.error('Lỗi AI: ' + (err as Error).message);
    } finally {
      setCompleting(false);
    }
  }, [editor, completing]);

  // Đè Tab → gọi handleComplete (chỉ khi editor focus)
  React.useEffect(() => {
    if (!editor) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !e.shiftKey && editor.isFocused) {
        e.preventDefault();
        handleComplete();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editor, handleComplete]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            debouncedSave({ title: e.target.value });
          }}
          placeholder="Tiêu đề note"
          className="flex-1 border-0 bg-transparent text-2xl font-semibold focus:outline-none focus:ring-0"
        />
        {savedAt && (
          <span className="text-xs text-muted-foreground">
            Đã lưu lúc {savedAt.toLocaleTimeString('vi-VN')}
          </span>
        )}
        <button
          type="button"
          onClick={handleComplete}
          disabled={completing}
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
          aria-label="AI gợi ý"
        >
          {completing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          AI (Tab)
        </button>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
