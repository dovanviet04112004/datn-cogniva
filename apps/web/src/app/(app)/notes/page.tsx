/**
 * /notes — list notes + nút tạo mới.
 *
 * Click 1 note → /notes/[id] để edit. Tạo mới → POST /api/notes → redirect.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Note = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
};

/** Bóc tag HTML → text thuần để preview ngắn. */
function previewText(html: string, max = 120): string {
  const text = html.replace(/<[^>]*>/g, '').trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export default function NotesPage() {
  const router = useRouter();
  const [notes, setNotes] = React.useState<Note[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/notes?limit=100')
      .then((r) => r.json())
      .then((d: { notes: Note[] }) => setNotes(d.notes))
      .finally(() => setLoading(false));
  }, []);

  const createNote = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled', content: '<p></p>' }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { note: Note };
      router.push(`/notes/${data.note.id}`);
    } catch (err) {
      toast.error('Tạo note thất bại: ' + (err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const deleteNote = async (id: string) => {
    try {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setNotes((ns) => ns.filter((n) => n.id !== id));
      toast.success('Đã xoá');
    } catch (err) {
      toast.error('Xoá thất bại: ' + (err as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Notes</h1>
          <p className="text-sm text-muted-foreground">
            Ghi chú có AI gợi ý — bấm Tab cuối câu để tiếp tục mạch văn.
          </p>
        </div>
        <Button onClick={createNote} disabled={creating}>
          <Plus className="mr-1 h-4 w-4" />
          Note mới
        </Button>
      </div>

      <div className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Đang tải...</p>}
        {!loading && notes.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            Chưa có note nào. Bấm <strong>Note mới</strong> để bắt đầu.
          </Card>
        )}
        {notes.map((n) => (
          <Card key={n.id} className="flex items-center gap-3 p-3">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Link href={`/notes/${n.id}`} className="min-w-0 flex-1 hover:underline">
              <p className="truncate text-sm font-medium">{n.title || 'Untitled'}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {previewText(n.content) || '(empty)'} ·{' '}
                {new Date(n.updatedAt).toLocaleString('vi-VN')}
              </p>
            </Link>
            <button
              onClick={() => deleteNote(n.id)}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Xoá"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}
