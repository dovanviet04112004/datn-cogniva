'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  FileText,
  Loader2,
  NotebookPen,
  Plus,
  Check,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';
import { getMasteryLevel, MASTERY_LEVEL_LABEL, type MasteryLevel } from '@/lib/mastery-ui';

const NEXT_LEVEL: Record<MasteryLevel, MasteryLevel> = {
  new: 'learning',
  learning: 'mastered',
  mastered: 'new',
};

const LEVEL_SCORE: Record<MasteryLevel, number | null> = {
  new: null,
  learning: 0.6,
  mastered: 0.9,
};
import { useConfirm } from '@/lib/use-confirm';
import { useDocPreview } from '@/components/chat/doc-preview-context';
import { useAtomPreview } from './atom-preview-context';
import { useNotePreview } from './note-preview-context';
import { NoteEditorDialog } from '@/components/notes/note-editor-dialog';
import { SourcesInlinePreview } from './sources-inline-preview';
import { SourcesAtomInlinePreview } from './sources-atom-inline-preview';
import { SourcesNoteInlinePreview } from './sources-note-inline-preview';
import { useNotebook } from './notebook-context';

type Doc = {
  id: string;
  filename: string;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  pageCount: number | null;
  chunks: number;
};

type Atom = {
  id: string;
  name: string;
  domain: string;
  masteryScore: number | null;
  flashcardCount: number;
  difficulty: number | null;
  lastSeenAt: string | null;
};

type Note = {
  id: string;
  title: string;
  updatedAt: string;
};

type Props = {
  workspaceId: string;
  documents: Doc[];
  onUploadClick: () => void;
};

export function SourcesPanel({ workspaceId, documents, onUploadClick }: Props) {
  const { selectedDocs, toggleDoc, setAllDocs, selectedAtoms, toggleAtom } = useNotebook();
  const confirm = useConfirm();
  const docPreview = useDocPreview();
  const atomPreview = useAtomPreview();
  const notePreview = useNotePreview();
  const [showAllAtoms, setShowAllAtoms] = React.useState(false);
  const [atomTab, setAtomTab] = React.useState<MasteryLevel>('new');
  const [creatingNote, setCreatingNote] = React.useState(false);
  const [deletingDocId, setDeletingDocId] = React.useState<string | null>(null);
  const router = useRouter();

  const handleDeleteDoc = async (docId: string, filename: string) => {
    if (deletingDocId) return;
    const ok = await confirm({
      title: `Xoá "${filename}"?`,
      description: 'Cả chunks + atom-link bị mất.',
      confirmLabel: 'Xoá',
      variant: 'destructive',
    });
    if (!ok) return;
    setDeletingDocId(docId);
    try {
      await apiSend(`/api/documents/${docId}`, 'DELETE');
      toast.success('Đã xoá document');
      if (docPreview?.citation?.documentId === docId) docPreview.close();
      router.refresh();
    } catch (err) {
      toast.error('Xoá lỗi: ' + (err as Error).message);
    } finally {
      setDeletingDocId(null);
    }
  };

  const notesVersion = notePreview?.notesVersion ?? 0;
  const { data: sources, isLoading: loading } = useQuery({
    queryKey: qk.workspaceSources(workspaceId, notesVersion),
    queryFn: () =>
      Promise.all([
        apiGet<{ atoms: Atom[] }>(
          `/api/workspaces/${workspaceId}/atoms?sort=mastery&limit=50`,
        ).then((d) => d.atoms ?? []),
        apiGet<{ notes: Note[] }>(`/api/notes?workspaceId=${workspaceId}&limit=20`)
          .then((d) => d.notes ?? [])
          .catch(() => [] as Note[]),
      ]).then(([atoms, notes]) => ({ atoms, notes })),
  });
  const atoms = sources?.atoms ?? [];
  const byLevel: Record<MasteryLevel, Atom[]> = { new: [], learning: [], mastered: [] };
  for (const a of atoms) byLevel[getMasteryLevel(a.masteryScore)].push(a);
  byLevel.new.sort((a, b) => (a.difficulty ?? 99) - (b.difficulty ?? 99));
  const byRecent = (a: Atom, b: Atom) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '');
  byLevel.learning.sort(byRecent);
  byLevel.mastered.sort(byRecent);
  const activeAtoms = byLevel[atomTab];
  const shownAtoms = showAllAtoms ? activeAtoms : activeAtoms.slice(0, 30);

  const queryClient = useQueryClient();
  const markAtom = async (conceptId: string, level: MasteryLevel) => {
    const sourcesKey = qk.workspaceSources(workspaceId, notesVersion);
    const prevData = queryClient.getQueryData<{ atoms: Atom[]; notes: Note[] }>(sourcesKey);
    queryClient.setQueryData<{ atoms: Atom[]; notes: Note[] }>(sourcesKey, (prev) =>
      prev
        ? {
            ...prev,
            atoms: prev.atoms.map((a) =>
              a.id === conceptId ? { ...a, masteryScore: LEVEL_SCORE[level] } : a,
            ),
          }
        : prev,
    );
    try {
      await apiSend('/api/mastery/mark', 'POST', { conceptId, level, workspaceId });
    } catch (e) {
      if (prevData) queryClient.setQueryData(sourcesKey, prevData);
      toast.error('Lỗi lưu trạng thái: ' + (e as Error).message);
    }
  };
  const notes = sources?.notes ?? [];

  const allSelected = documents.every((d) => selectedDocs.has(d.id));

  const showAtomInline = atomPreview?.atomId != null;
  const showDocInline = docPreview?.citation != null && docPreview.mode === 'inline';
  const showNoteInline = notePreview?.noteId != null && notePreview.mode === 'inline';

  const noteDialog = (
    <NoteEditorDialog
      noteId={notePreview?.noteId ?? null}
      open={notePreview?.noteId != null && notePreview.mode === 'modal'}
      onOpenChange={(o) => {
        if (!o) {
          notePreview?.setMode('inline');
          notePreview?.bumpNotesVersion();
        }
      }}
    />
  );

  if (showAtomInline) {
    return (
      <>
        <SourcesAtomInlinePreview />
        {noteDialog}
      </>
    );
  }
  if (showDocInline) {
    return (
      <>
        <SourcesInlinePreview />
        {noteDialog}
      </>
    );
  }
  if (showNoteInline) {
    return (
      <>
        <SourcesNoteInlinePreview />
        {noteDialog}
      </>
    );
  }

  return (
    <aside className="bg-card flex h-full flex-col overflow-hidden border-r">
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
            Sources
          </h2>
          <button
            onClick={onUploadClick}
            className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium"
          >
            <Upload className="h-3 w-3" />
            Upload
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <Section
          icon={<FileText className="h-3 w-3" />}
          label={`Documents (${documents.length})`}
          rightAction={
            documents.length > 0 ? (
              <button
                onClick={() =>
                  allSelected ? setAllDocs([]) : setAllDocs(documents.map((d) => d.id))
                }
                className="text-muted-foreground hover:text-foreground text-[11px]"
              >
                {allSelected ? 'Bỏ hết' : 'Chọn hết'}
              </button>
            ) : null
          }
          defaultOpen
        >
          {documents.length === 0 ? (
            <EmptyHint text="Upload PDF để bắt đầu" />
          ) : (
            <ul className="space-y-0.5">
              {documents.map((d) => {
                const isReady = d.status === 'READY';
                const canPreview = isReady && docPreview != null;
                return (
                  <li
                    key={d.id}
                    className={cn(
                      'group flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors',
                      selectedDocs.has(d.id)
                        ? 'bg-primary/5 text-foreground'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDocs.has(d.id)}
                      onChange={() => toggleDoc(d.id)}
                      aria-label={`Chọn ${d.filename} làm nguồn cho chat`}
                      className="border-divider text-primary focus:ring-primary h-3.5 w-3.5 shrink-0 cursor-pointer rounded focus:ring-1"
                    />
                    <FileText className="text-muted-foreground h-3 w-3 shrink-0" />
                    <button
                      type="button"
                      onClick={() => {
                        if (!canPreview) return;
                        atomPreview?.close();
                        notePreview?.close();
                        docPreview!.openDocument({
                          documentId: d.id,
                          filename: d.filename,
                        });
                      }}
                      disabled={!canPreview}
                      title={
                        canPreview
                          ? `Mở ${d.filename}`
                          : isReady
                            ? d.filename
                            : `${d.filename} (đang xử lý)`
                      }
                      className={cn(
                        'min-w-0 flex-1 truncate text-left transition-colors',
                        canPreview ? 'hover:text-primary cursor-pointer' : 'cursor-default',
                      )}
                    >
                      {d.filename}
                    </button>
                    {d.status !== 'READY' && (
                      <span className="bg-warning/10 text-warning shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold">
                        {d.status}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDoc(d.id, d.filename);
                      }}
                      disabled={deletingDocId === d.id}
                      aria-label={`Xoá ${d.filename}`}
                      title="Xoá document"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity disabled:opacity-50 group-hover:opacity-100"
                    >
                      {deletingDocId === d.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          icon={<Sparkles className="text-primary h-3 w-3" />}
          label={`Atoms (${atoms.length})`}
          defaultOpen
        >
          {loading ? (
            <EmptyHint text="Đang load…" />
          ) : atoms.length === 0 ? (
            <EmptyHint text="Chưa có atom — đợi AI extract (~30-60s sau upload)" />
          ) : (
            <>
              <div className="mb-1.5 flex gap-1">
                {(
                  [
                    { key: 'new', label: 'Chưa học', active: 'bg-muted text-foreground' },
                    { key: 'learning', label: 'Đang học', active: 'bg-warning/15 text-warning' },
                    { key: 'mastered', label: 'Đã nắm', active: 'bg-success/15 text-success' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => {
                      setAtomTab(t.key);
                      setShowAllAtoms(false);
                    }}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1 text-[10px] font-semibold transition-colors',
                      atomTab === t.key ? t.active : 'text-muted-foreground hover:bg-muted/60',
                    )}
                  >
                    <span className="truncate">{t.label}</span>
                    <span className="shrink-0 tabular-nums opacity-70">
                      {byLevel[t.key].length}
                    </span>
                  </button>
                ))}
              </div>

              {activeAtoms.length === 0 ? (
                <EmptyHint
                  text={
                    atomTab === 'new'
                      ? '🎉 Không còn atom chưa học'
                      : atomTab === 'learning'
                        ? 'Chưa có atom đang học — ôn/quiz để bắt đầu'
                        : 'Chưa có atom đã nắm — bấm ○ ở atom để đánh dấu'
                  }
                />
              ) : (
                <>
                  <ul className="space-y-0.5">
                    {shownAtoms.map((a) => (
                      <AtomRow
                        key={a.id}
                        atom={a}
                        checked={selectedAtoms.has(a.id)}
                        onToggle={() => toggleAtom(a.id)}
                        onMark={(level) => markAtom(a.id, level)}
                        onOpen={() => {
                          docPreview?.close();
                          notePreview?.close();
                          atomPreview?.open(a.id);
                        }}
                      />
                    ))}
                  </ul>
                  {activeAtoms.length > 30 && (
                    <button
                      type="button"
                      onClick={() => setShowAllAtoms((v) => !v)}
                      className="text-muted-foreground hover:text-primary mt-1 px-2 text-[11px] font-medium"
                    >
                      {showAllAtoms ? 'Thu gọn — 30 đầu' : `Hiện tất cả ${activeAtoms.length}`}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </Section>

        <Section
          icon={<NotebookPen className="h-3 w-3" />}
          label={`Notes (${notes.length})`}
          rightAction={
            <button
              type="button"
              disabled={creatingNote}
              onClick={async () => {
                setCreatingNote(true);
                try {
                  const json = await apiSend<{
                    note: { id: string; title: string };
                  }>('/api/notes', 'POST', {
                    title: 'Untitled',
                    content: '',
                    workspaceId,
                  });
                  docPreview?.close();
                  atomPreview?.close();
                  notePreview?.open(json.note.id);
                  notePreview?.bumpNotesVersion();
                } catch (err) {
                  toast.error('Tạo note lỗi: ' + (err as Error).message);
                } finally {
                  setCreatingNote(false);
                }
              }}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] disabled:opacity-50"
            >
              <Plus className="h-2.5 w-2.5" />
              {creatingNote ? 'Đang tạo…' : 'New'}
            </button>
          }
        >
          {notes.length === 0 ? (
            <EmptyHint text="Chưa có note" />
          ) : (
            <ul className="space-y-0.5">
              {notes.slice(0, 10).map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      docPreview?.close();
                      atomPreview?.close();
                      notePreview?.open(n.id);
                    }}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground block w-full rounded-md px-2 py-1 text-left text-[12px] transition-colors"
                  >
                    <p className="truncate">{n.title || 'Untitled'}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {noteDialog}
    </aside>
  );
}

function Section({
  icon,
  label,
  rightAction,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  rightAction?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const storageKey = React.useMemo(() => {
    const base = label.split(/[(\s]/)[0] || label;
    return `cogniva.v5.sources-section.${base.toLowerCase()}`;
  }, [label]);

  const [open, setOpen] = React.useState<boolean>(defaultOpen);
  const hydratedRef = React.useRef(false);

  React.useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v === '1') setOpen(true);
      else if (v === '0') setOpen(false);
    } catch {}
  }, [storageKey]);

  React.useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      window.localStorage.setItem(storageKey, open ? '1' : '0');
    } catch {}
  }, [open, storageKey]);

  return (
    <section className="border-b last:border-b-0">
      <header className="flex items-center justify-between px-3 py-2">
        <button
          onClick={() => setOpen(!open)}
          className="text-foreground hover:text-primary inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
        >
          <ChevronDown
            suppressHydrationWarning
            className={cn('h-3 w-3 transition-transform', !open && '-rotate-90')}
          />
          {icon}
          {label}
        </button>
        {rightAction}
      </header>
      <div className={cn('px-2 pb-2', !open && 'hidden')} suppressHydrationWarning>
        {children}
      </div>
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-muted-foreground px-2 py-1 text-[11px]">{text}</p>;
}

function AtomRow({
  atom,
  checked,
  onToggle,
  onOpen,
  onMark,
}: {
  atom: Atom;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onMark?: (level: MasteryLevel) => void;
}) {
  const level = getMasteryLevel(atom.masteryScore);
  const pct = atom.masteryScore !== null ? Math.round(atom.masteryScore * 100) : null;
  return (
    <li
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1 text-[12px] transition-colors',
        checked ? 'bg-primary/10' : 'hover:bg-muted',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="border-divider text-primary focus:ring-primary h-3.5 w-3.5 shrink-0 cursor-pointer rounded focus:ring-1"
      />
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'hover:text-primary min-w-0 flex-1 truncate text-left',
          level === 'new' ? 'text-muted-foreground' : 'text-foreground/90',
        )}
        title={atom.name}
      >
        {atom.name}
      </button>
      {pct !== null && (
        <span
          className={cn(
            'shrink-0 text-[10px] font-semibold tabular-nums',
            pct >= 80 ? 'text-success' : 'text-warning',
          )}
          title={`Mastery ${pct}%`}
        >
          {pct}%
        </span>
      )}
      {onMark && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMark(NEXT_LEVEL[level]);
          }}
          title={`Chuyển sang: ${MASTERY_LEVEL_LABEL[NEXT_LEVEL[level]]}`}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
            level === 'mastered'
              ? 'border-success bg-success text-white'
              : level === 'learning'
                ? 'border-warning bg-warning/25 text-warning'
                : 'border-muted-foreground/40 hover:border-primary text-transparent',
          )}
        >
          {level === 'mastered' ? (
            <Check className="h-2.5 w-2.5" />
          ) : level === 'learning' ? (
            <span className="bg-warning h-1.5 w-1.5 rounded-full" />
          ) : null}
        </button>
      )}
    </li>
  );
}
