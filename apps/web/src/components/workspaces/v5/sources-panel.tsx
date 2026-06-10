/**
 * SourcesPanel — cột trái V5 workspace notebook.
 *
 * Spec: docs/plans/v5-notebooklm-layout.md §4.3.
 *
 * 3 section collapsible:
 *   1. Documents — checkbox scope (đã có ở context.selectedDocs)
 *   2. Atoms — checkbox + mastery chip 3 màu
 *   3. Notes — list compact
 *
 * Click 1 atom (không phải checkbox) → mở atom detail page (deep link).
 * Toggle checkbox → update scope cho main panel (chat / recipes dùng).
 */
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

/** Bấm nút tròn → cycle: Chưa học → Đang học → Đã nắm → (Chưa học). */
const NEXT_LEVEL: Record<MasteryLevel, MasteryLevel> = {
  new: 'learning',
  learning: 'mastered',
  mastered: 'new',
};

/**
 * Score gán cho từng level — DÙNG CHO OPTIMISTIC UPDATE phía client (phải khớp
 * LEVEL_SCORE ở /api/mastery/mark để không nháy khi refetch về).
 *   - new       → null  (xoá mastery row → "chưa học")
 *   - learning  → 0.6   (< 0.8 → getMasteryLevel = 'learning')
 *   - mastered  → 0.9   (≥ 0.8 → 'mastered')
 */
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
  /** Độ khó (0..1) — sort cột "Chưa học" theo thứ tự cần học (dễ/nền tảng trước). */
  difficulty: number | null;
  /** Mốc hoạt động gần nhất — sort "Đang học/Đã nắm" mới-nhất-lên-đầu. */
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
  /** Trigger upload dialog từ parent (workspace-notebook.tsx). */
  onUploadClick: () => void;
};

export function SourcesPanel({ workspaceId, documents, onUploadClick }: Props) {
  const { selectedDocs, toggleDoc, setAllDocs, selectedAtoms, toggleAtom } =
    useNotebook();
  const confirm = useConfirm();
  // V8.1: click filename → mở doc preview ở right panel (không navigate).
  const docPreview = useDocPreview();
  // V8.10: click atom row → mở atom preview inline (không navigate ra /atoms/).
  const atomPreview = useAtomPreview();
  // V8.12: note flow giống doc/atom — inline preview ở sidebar, zoom → modal.
  const notePreview = useNotePreview();
  // Show-more: clamp 30 atom, bấm "Hiện tất cả" để mở hết.
  const [showAllAtoms, setShowAllAtoms] = React.useState(false);
  // Tab nhóm atom đang xem — bấm tab → hiện atom của nhóm đó.
  const [atomTab, setAtomTab] = React.useState<MasteryLevel>('new');
  // Loading state cho nút "New" — POST /api/notes tạo note rỗng + auto-open
  const [creatingNote, setCreatingNote] = React.useState(false);
  // V8.13: id doc đang xoá (disable nút trong lúc API chạy)
  const [deletingDocId, setDeletingDocId] = React.useState<string | null>(null);
  const router = useRouter();

  /** Xoá doc + close preview nếu đang xem doc đó + router.refresh() list */
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
      // Nếu đang preview doc bị xoá → close
      if (docPreview?.citation?.documentId === docId) docPreview.close();
      router.refresh(); // server re-fetch documents list
    } catch (err) {
      toast.error('Xoá lỗi: ' + (err as Error).message);
    } finally {
      setDeletingDocId(null);
    }
  };

  // V8.13: notesVersion bump (note save title / delete / create) → đổi key →
  // React Query refetch atoms+notes list. Atoms+notes gộp 1 query (Promise.all).
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
  // 3 nhóm cho 3 CỘT cạnh nhau: Chưa học · Đang học · Đã nắm.
  const byLevel: Record<MasteryLevel, Atom[]> = { new: [], learning: [], mastered: [] };
  for (const a of atoms) byLevel[getMasteryLevel(a.masteryScore)].push(a);
  // Chưa học: thứ tự CẦN HỌC — dễ/nền tảng trước (difficulty ASC, null xuống cuối).
  byLevel.new.sort((a, b) => (a.difficulty ?? 99) - (b.difficulty ?? 99));
  // Đang học / Đã nắm: hoạt động MỚI NHẤT lên đầu (lastSeenAt giảm dần).
  const byRecent = (a: Atom, b: Atom) =>
    (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '');
  byLevel.learning.sort(byRecent);
  byLevel.mastered.sort(byRecent);
  // Atom của tab đang chọn (full-width list bên dưới các tab).
  const activeAtoms = byLevel[atomTab];
  const shownAtoms = showAllAtoms ? activeAtoms : activeAtoms.slice(0, 30);

  const queryClient = useQueryClient();
  // Chuyển atom sang level mới. KHÔNG tự nhảy tab (user tự bấm tab để xem).
  //
  // Pattern: OPTIMISTIC + ROLLBACK-ON-ERROR, KHÔNG refetch khi thành công.
  //   - mark chỉ đổi DUY NHẤT 1 field `masteryScore` về GIÁ TRỊ ĐÃ BIẾT
  //     (LEVEL_SCORE[level]) — set thẳng vào cache React Query → atom đổi nhóm
  //     tức thì, không field nào khác đổi.
  //   - Vì đã biết chính xác kết quả, refetch ngay sau đó CHỈ CÓ HẠI: nó có thể
  //     kéo về snapshot cache/replica cũ (đọc trước khi ghi kịp lan) → atom
  //     "nhẩy ngược" về chưa-học sau vài giây. Nên KHÔNG refetch khi OK.
  //   - Cache Redis atom-list đã được bust ở server (onMasteryChanged) → lần
  //     refetch TỰ NHIÊN sau này (đổi notesVersion / focus) đọc DB tươi, vẫn đúng.
  //   - Lỗi thật → rollback snapshot cũ + báo. (Nếu revert KÈM toast này → API
  //     /api/mastery/mark đang lỗi, thường do dev server giữ route cũ → restart.)
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

  // V8.12: 3 type inline preview mutex (doc / atom / note). Handler click
  // ở dưới đảm bảo close 2 cái còn lại khi open 1 cái.
  const showAtomInline = atomPreview?.atomId != null;
  const showDocInline =
    docPreview?.citation != null && docPreview.mode === 'inline';
  const showNoteInline =
    notePreview?.noteId != null && notePreview.mode === 'inline';

  // Note modal dialog — render khi mode='modal' (sau khi user zoom inline)
  const noteDialog = (
    <NoteEditorDialog
      noteId={notePreview?.noteId ?? null}
      open={notePreview?.noteId != null && notePreview.mode === 'modal'}
      onOpenChange={(o) => {
        if (!o) {
          // Đóng modal → back to inline
          notePreview?.setMode('inline');
          // V8.13: ensure list refetch sau khi user edit trong modal (TipTap
          // autosave debounce ~1.2s). Có thể race nhẹ — user đợi 1-2s trước
          // khi close là sync chuẩn.
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
    <aside className="flex h-full flex-col overflow-hidden border-r bg-card">
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sources
          </h2>
          <button
            onClick={onUploadClick}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 text-[11px] font-medium text-primary hover:bg-primary/10"
          >
            <Upload className="h-3 w-3" />
            Upload
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Documents section */}
        <Section
          icon={<FileText className="h-3 w-3" />}
          label={`Documents (${documents.length})`}
          rightAction={
            documents.length > 0 ? (
              <button
                onClick={() =>
                  allSelected ? setAllDocs([]) : setAllDocs(documents.map((d) => d.id))
                }
                className="text-[11px] text-muted-foreground hover:text-foreground"
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
                // V8.1: row chia 2 hit-area:
                //   - checkbox (trái) → toggle scope cho chat/recipes
                //   - filename (giữa, button) → mở PDF preview ở right panel
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
                      className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-divider text-primary focus:ring-1 focus:ring-primary"
                    />
                    <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <button
                      type="button"
                      onClick={() => {
                        if (!canPreview) return;
                        // V8.12 mutex 3 preview type
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
                        canPreview
                          ? 'cursor-pointer hover:text-primary'
                          : 'cursor-default',
                      )}
                    >
                      {d.filename}
                    </button>
                    {d.status !== 'READY' && (
                      <span className="shrink-0 rounded bg-warning/10 px-1 py-0.5 text-[10px] font-semibold text-warning">
                        {d.status}
                      </span>
                    )}
                    {/* V8.13: delete button — chỉ visible khi hover row */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDoc(d.id, d.filename);
                      }}
                      disabled={deletingDocId === d.id}
                      aria-label={`Xoá ${d.filename}`}
                      title="Xoá document"
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
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

        {/* Atoms section */}
        <Section
          icon={<Sparkles className="h-3 w-3 text-primary" />}
          label={`Atoms (${atoms.length})`}
          defaultOpen
        >
          {loading ? (
            <EmptyHint text="Đang load…" />
          ) : atoms.length === 0 ? (
            <EmptyHint text="Chưa có atom — đợi AI extract (~30-60s sau upload)" />
          ) : (
            <>
              {/* 3 TAB ngang — bấm tab nào → hiện atom nhóm đó (full-width, sidebar
                  hẹp không hiện 3 cột cùng lúc được). */}
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
                    <span className="shrink-0 tabular-nums opacity-70">{byLevel[t.key].length}</span>
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
                      className="mt-1 px-2 text-[11px] font-medium text-muted-foreground hover:text-primary"
                    >
                      {showAllAtoms ? 'Thu gọn — 30 đầu' : `Hiện tất cả ${activeAtoms.length}`}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </Section>

        {/* Notes section.
            V8.12: "New" giờ POST /api/notes tạo note rỗng + auto-open inline.
            Bỏ Link /notes/new (trang không tồn tại). */}
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
                  // Mở inline preview (mutex các preview khác)
                  docPreview?.close();
                  atomPreview?.close();
                  notePreview?.open(json.note.id);
                  // Bump → query refetch list, note mới xuất hiện.
                  notePreview?.bumpNotesVersion();
                } catch (err) {
                  toast.error('Tạo note lỗi: ' + (err as Error).message);
                } finally {
                  setCreatingNote(false);
                }
              }}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
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
                      // V8.12 mutex 3 preview type
                      docPreview?.close();
                      atomPreview?.close();
                      notePreview?.open(n.id);
                    }}
                    className="block w-full rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <p className="truncate">{n.title || 'Untitled'}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* V8.10: modal edit note (mở khi user click note row).
          V8.11: dùng cùng instance noteDialog ở mọi branch. */}
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
  // V8.14: persist open state qua localStorage để user collapse rồi reload
  // không bị mở lại. Key dựa vào label gốc trước paren (vd "Atoms (24)" → "Atoms").
  const storageKey = React.useMemo(() => {
    const base = label.split(/[(\s]/)[0] || label;
    return `cogniva.v5.sources-section.${base.toLowerCase()}`;
  }, [label]);

  // Init = defaultOpen ở cả SSR + client lần đầu để KHÔNG hydration mismatch.
  // Sau mount, useEffect đọc localStorage và sync. Có thể flash 1 frame nếu
  // value khác defaultOpen — chấp nhận để tránh mismatch error.
  const [open, setOpen] = React.useState<boolean>(defaultOpen);
  const hydratedRef = React.useRef(false);

  // Hydrate từ localStorage sau mount (chỉ 1 lần)
  React.useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v === '1') setOpen(true);
      else if (v === '0') setOpen(false);
    } catch {
      /* private mode / quota — bỏ qua */
    }
  }, [storageKey]);

  // Persist khi user toggle (skip lần hydrate đầu để không ghi đè ngay)
  React.useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      window.localStorage.setItem(storageKey, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [open, storageKey]);

  return (
    <section className="border-b last:border-b-0">
      <header className="flex items-center justify-between px-3 py-2">
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground hover:text-primary"
        >
          {/* suppressHydrationWarning: state có thể đổi sau hydration do
              localStorage useEffect — chỉ là class rotate, chấp nhận flash. */}
          <ChevronDown
            suppressHydrationWarning
            className={cn(
              'h-3 w-3 transition-transform',
              !open && '-rotate-90',
            )}
          />
          {icon}
          {label}
        </button>
        {rightAction}
      </header>
      {/* Render content luôn — dùng `hidden` thay vì conditional mount để
          tree structure (và useId counter) ổn định giữa SSR ↔ CSR. */}
      <div
        className={cn('px-2 pb-2', !open && 'hidden')}
        suppressHydrationWarning
      >
        {children}
      </div>
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="px-2 py-1 text-[11px] text-muted-foreground">{text}</p>;
}

function AtomRow({
  atom,
  checked,
  onToggle,
  onOpen,
  onMark,
}: {
  /** Bỏ workspaceId — V8.10 không navigate ra ngoài nữa, click → inline. */
  atom: Atom;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** Chuyển atom sang level (Chưa học / Đang học / Đã nắm). */
  onMark?: (level: MasteryLevel) => void;
}) {
  // checkbox chọn (scope) + tên (bấm mở preview) + % mastery + nút tròn nhảy nhóm.
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
        className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-divider text-primary focus:ring-1 focus:ring-primary"
      />
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'min-w-0 flex-1 truncate text-left hover:text-primary',
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
      {/* Nút tròn — BẤM LÀ CYCLE: Chưa học → Đang học → Đã nắm → Chưa học.
          Atom rời nhóm hiện tại ngay (optimistic); user tự bấm tab để xem nhóm mới. */}
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
                : 'border-muted-foreground/40 text-transparent hover:border-primary',
          )}
        >
          {level === 'mastered' ? (
            <Check className="h-2.5 w-2.5" />
          ) : level === 'learning' ? (
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
          ) : null}
        </button>
      )}
    </li>
  );
}
