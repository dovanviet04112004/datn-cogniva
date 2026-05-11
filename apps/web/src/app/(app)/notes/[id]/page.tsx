/**
 * /notes/[id] — load note + render NoteEditor (TipTap + autosave + AI).
 *
 * Client-only: fetch /api/notes/[id] khi mount.
 */
'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { NoteEditor } from '@/components/notes/note-editor';

type PageProps = {
  params: Promise<{ id: string }>;
};

type Note = {
  id: string;
  title: string;
  content: string;
};

export default function NotePage({ params }: PageProps) {
  const { id } = use(params);
  const [note, setNote] = React.useState<Note | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch(`/api/notes/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return (await r.json()) as { note: Note };
      })
      .then((d) => setNote(d.note))
      .catch((err: Error) => {
        setError(err.message);
        toast.error('Không load được note: ' + err.message);
      });
  }, [id]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">
        Lỗi: {error}
      </div>
    );
  }
  if (!note) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center p-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Đang tải note...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Link href="/notes">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Về danh sách
        </Button>
      </Link>
      <NoteEditor
        noteId={note.id}
        initialTitle={note.title}
        initialContent={note.content}
      />
    </div>
  );
}
