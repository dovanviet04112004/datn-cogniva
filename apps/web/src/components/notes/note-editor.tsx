'use client';

import * as React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

type Props = {
  noteId: string;
  initialTitle: string;
  initialContent: string;
};

function useDebouncedCallback<T extends (...args: never[]) => void>(cb: T, delay: number) {
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
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[300px]',
      },
    },
    onUpdate: ({ editor }) => {
      debouncedSave({ content: editor.getHTML() });
    },
  });

  const handleComplete = React.useCallback(async () => {
    if (!editor || completing) return;
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
        editor
          .chain()
          .focus()
          .insertContent(' ' + completion)
          .run();
      }
    } catch (err) {
      toast.error('Lỗi AI: ' + (err as Error).message);
    } finally {
      setCompleting(false);
    }
  }, [editor, completing]);

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
          <span className="text-muted-foreground text-xs">
            Đã lưu lúc {savedAt.toLocaleTimeString('vi-VN')}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleComplete}
          disabled={completing}
          aria-label="AI gợi ý"
        >
          {completing ? <Loader2 className="animate-spin" /> : <Sparkles />}
          AI (Tab)
        </Button>
      </div>
      <div className="bg-card rounded-lg border p-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
