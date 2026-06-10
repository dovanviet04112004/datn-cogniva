/**
 * SourcesNoteInlinePreview — V8.12 (2026-05-20).
 *
 * Render khi `useNotePreview().noteId != null && mode === 'inline'` — sidebar
 * Sources tạm thời thay đổi content thành compact preview của note đang xem.
 *
 * Layout (fit 320px sidebar):
 *   - Header: title (editable inline) + zoom + X close
 *   - Meta: updated time
 *   - Body: plain text preview (HTML stripped), scrollable
 *   - Footer: "Mở full editor" button → setMode('modal')
 *
 * KHÔNG render TipTap editor ở đây — 320px hẹp + features Tab/AI cần space.
 * Modal mới là editor đầy đủ.
 *
 * Fetch /api/notes/[id].
 */
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

/** Save title qua PATCH. Toast lỗi nếu fail. Return note mới nếu OK. */
async function saveTitle(
  noteId: string,
  newTitle: string,
): Promise<NoteData | null> {
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

/** Strip HTML tags để show preview text-only. */
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
  /** Title đang edit inline (null = view mode). */
  const [editingTitle, setEditingTitle] = React.useState<string | null>(null);
  const [savingTitle, setSavingTitle] = React.useState(false);

  const [deleting, setDeleting] = React.useState(false);

  const noteId = ctx?.noteId ?? null;

  // Dùng chung key qk.note(id) với trang /notes/[id] + NoteEditorDialog → sửa
  // title ở đây cập nhật luôn cache các nơi kia (và ngược lại).
  const { data, isLoading: loading } = useQuery({
    queryKey: qk.note(noteId ?? ''),
    queryFn: () =>
      apiGet<{ note: NoteData }>(`/api/notes/${noteId}`).then((d) => d.note),
    enabled: !!noteId,
  });

  /** Delete note + close preview + trigger list refetch ở SourcesPanel. */
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
      ctx.bumpNotesVersion(); // SourcesPanel refetch list
      ctx.close(); // back to sources list view
    } catch (err) {
      toast.error('Xoá lỗi: ' + (err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  if (!ctx?.noteId) return null;

  const previewText = data ? stripHtml(data.content) : '';

  return (
    <aside className="flex h-full flex-col overflow-hidden border-r bg-card">
      {/* Header — title click để edit inline */}
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-start gap-2">
          <NotebookPen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
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
                  // Ghi thẳng vào cache chung → đồng bộ mọi nơi đọc qk.note(id).
                  qc.setQueryData(qk.note(data.id), updated);
                  // V8.13: bump để SourcesPanel refetch notes list → sync title
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
              className="min-w-0 flex-1 rounded border border-primary/40 bg-background px-1.5 py-0.5 text-[13px] font-semibold tracking-tight outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <button
              type="button"
              onClick={() => data && setEditingTitle(data.title)}
              disabled={!data}
              title={data ? `${data.title} — click để đổi tên` : ''}
              className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold tracking-tight hover:text-primary disabled:cursor-default"
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
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
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
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => ctx.close()}
            aria-label="Đóng — quay lại danh sách"
            title="Đóng"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {data?.updatedAt && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Cập nhật {new Date(data.updatedAt).toLocaleString('vi-VN')}
          </p>
        )}
      </header>

      {/* Body — plain text preview */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading && !data ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !data ? (
          <p className="text-center text-[11px] text-muted-foreground">
            Note không tải được.
          </p>
        ) : previewText.length === 0 ? (
          <p className="text-center text-[11px] italic text-muted-foreground">
            Note trống. Bấm nút mở rộng ở góc trên để bắt đầu viết.
          </p>
        ) : (
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90">
            {previewText}
          </p>
        )}
      </div>
      {/* Đã bỏ footer "Mở full editor" — trùng nút zoom ở header. */}
    </aside>
  );
}
