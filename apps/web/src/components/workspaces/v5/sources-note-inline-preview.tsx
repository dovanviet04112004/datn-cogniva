'use client';

import * as React from 'react';
import { Loader2, Maximize2, NotebookPen, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { useConfirm } from '@/lib/use-confirm';
import { useNotePreview } from './note-preview-context';

type NoteData = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
};

async function saveTitle(noteId: string, newTitle: string): Promise<NoteData | null> {
  try {
    const res = await fetch(`/api/notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = (await res.json()) as { note: NoteData };
    return json.note;
  } catch (err) {
    toast.error('Lưu title lỗi: ' + (err as Error).message);
    return null;
  }
}

function stripHtml(html: string): string {
  if (typeof window === 'undefined') return html.replace(/<[^>]*>/g, ' ');
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? div.innerText ?? '').trim();
}

export function SourcesNoteInlinePreview() {
  const ctx = useNotePreview();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [editingTitle, setEditingTitle] = React.useState<string | null>(null);
  const [savingTitle, setSavingTitle] = React.useState(false);

  const [deleting, setDeleting] = React.useState(false);

  const noteId = ctx?.noteId ?? null;

  const { data, isLoading: loading } = useQuery({
    queryKey: qk.note(noteId ?? ''),
    queryFn: () => apiGet<{ note: NoteData }>(`/api/notes/${noteId}`).then((d) => d.note),
    enabled: !!noteId,
  });

  const handleDelete = async () => {
    if (!data || deleting || !ctx) return;
    const ok = await confirm({
      title: `Xoá note "${data.title}"?`,
      description: 'Không khôi phục được.',
      confirmLabel: 'Xoá',
      variant: 'destructive',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/notes/${data.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      toast.success('Đã xoá note');
      ctx.bumpNotesVersion();
      ctx.close();
    } catch (err) {
      toast.error('Xoá lỗi: ' + (err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  if (!ctx?.noteId) return null;

  const previewText = data ? stripHtml(data.content) : '';

  return (
    <aside className="bg-card flex h-full flex-col overflow-hidden border-r">
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-start gap-2">
          <NotebookPen className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />
          {editingTitle !== null && data ? (
            <input
              type="text"
              value={editingTitle}
              autoFocus
              onChange={(e) => setEditingTitle(e.target.value)}
              onBlur={async () => {
                if (savingTitle) return;
                const next = editingTitle.trim();
                if (!next || next === data.title) {
                  setEditingTitle(null);
                  return;
                }
                setSavingTitle(true);
                const updated = await saveTitle(data.id, next);
                if (updated) {
                  qc.setQueryData(qk.note(data.id), updated);
                  ctx.bumpNotesVersion();
                }
                setSavingTitle(false);
                setEditingTitle(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  setEditingTitle(null);
                }
              }}
              maxLength={200}
              className="border-primary/40 bg-background focus:ring-primary min-w-0 flex-1 rounded border px-1.5 py-0.5 text-[13px] font-semibold tracking-tight outline-none focus:ring-1"
            />
          ) : (
            <button
              type="button"
              onClick={() => data && setEditingTitle(data.title)}
              disabled={!data}
              title={data ? `${data.title} — click để đổi tên` : ''}
              className="hover:text-primary min-w-0 flex-1 truncate text-left text-[13px] font-semibold tracking-tight disabled:cursor-default"
            >
              {data?.title || (loading ? 'Đang tải…' : 'Note')}
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={!data || deleting}
            aria-label="Xoá note"
            title="Xoá note"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => ctx.setMode('modal')}
            aria-label="Mở rộng — edit full"
            title="Mở full editor"
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => ctx.close()}
            aria-label="Đóng — quay lại danh sách"
            title="Đóng"
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {data?.updatedAt && (
          <p className="text-muted-foreground mt-1 text-[11px]">
            Cập nhật {new Date(data.updatedAt).toLocaleString('vi-VN')}
          </p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading && !data ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          </div>
        ) : !data ? (
          <p className="text-muted-foreground text-center text-[11px]">Note không tải được.</p>
        ) : previewText.length === 0 ? (
          <p className="text-muted-foreground text-center text-[11px] italic">
            Note trống. Bấm nút mở rộng ở góc trên để bắt đầu viết.
          </p>
        ) : (
          <p className="text-foreground/90 whitespace-pre-wrap text-[12px] leading-relaxed">
            {previewText}
          </p>
        )}
      </div>
    </aside>
  );
}
