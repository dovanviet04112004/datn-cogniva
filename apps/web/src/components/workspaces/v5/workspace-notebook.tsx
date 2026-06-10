/**
 * WorkspaceNotebook — layout V5/V6 root, 3 cột (Sources | Main | Studio).
 *
 * Spec: docs/plans/v5-notebooklm-layout.md + V6 updates 2026-05-20.
 *
 * V6 changes:
 *   - Compact header 1 row (title inline với meta + edit/delete dropdown)
 *   - 2 panel toggle button (PanelLeft + PanelRight) hoạt động ở CẢ desktop
 *     + mobile:
 *       · Desktop (lg+): collapse inline với width transition (no flicker
 *         vì cookie-persist server-side trước hydrate)
 *       · Mobile: drawer slide với overlay
 *   - State persistent qua cookie `cogniva.ws-sources-open` + `.ws-studio-open`
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronRight,
  Edit2,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { apiSend } from '@cogniva/shared/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RelativeTime } from '@/components/ui/relative-time';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/use-confirm';

import { NotebookProvider } from './notebook-context';
import { SourcesPanel } from './sources-panel';
import { MainPanel } from './main-panel';
import { StudioPanel } from './studio-panel';
import { UploadDocumentDialog } from '@/components/documents/upload-document-dialog';
import { DocPreviewProvider } from '@/components/chat/doc-preview-context';
import { DocPreviewPanel } from '@/components/chat/doc-preview-panel';
import { AtomPreviewProvider } from './atom-preview-context';
import { NotePreviewProvider } from './note-preview-context';
import {
  ExamPreviewProvider,
  useExamPreview,
} from './exam-preview-context';
import { ExamEditorDialog } from '@/components/exams/exam-editor-dialog';
import { RecipeOverlay } from './recipe-overlay';

/**
 * RightSidebar — right column V6/V8.4: chỉ Studio.
 *
 * V8.4 pivot (2026-05-20): DocPreview KHÔNG còn ở right column nữa, mà
 * thay vào Main center (giống NotebookLM source viewer). Lý do: khi đọc
 * PDF user vẫn muốn Studio (note/flashcard/mind map) visible bên phải để
 * thao tác song song.
 *
 * Right column giờ đơn giản: StudioPanel + toggle qua studioOpen state.
 */

function RightSidebar({
  studioOpen,
  setStudioOpen: _setStudioOpen,
  workspaceId,
  mobileActive,
}: {
  studioOpen: boolean;
  setStudioOpen: (next: boolean) => void;
  workspaceId: string;
  /** V8.18: true khi mobile tab='studio' — render full-width thay drawer. */
  mobileActive: boolean;
}) {
  // V8.18.4: UNMOUNT khi đóng thay vì width=0. Width transition không quan
  // trọng bằng việc đảm bảo layout sạch (không intrinsic leak từ inner).
  // Mobile: chỉ render khi tab active.
  if (!mobileActive && !studioOpen) return null;
  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden',
        mobileActive
          ? 'flex w-full flex-1 lg:w-auto lg:flex-none'
          : 'hidden lg:block',
        // Khi mở: width fixed; khi mobileActive (chưa studioOpen) → desktop
        // hidden, mobile full.
        studioOpen && 'lg:w-[360px]',
      )}
    >
      <div className="h-full w-full">
        <StudioPanel workspaceId={workspaceId} />
      </div>
    </div>
  );
}

/**
 * ExamEditorMount — V8.21: mount `<ExamEditorDialog>` ở root WorkspaceNotebook,
 * controlled qua `useExamPreview()` context. Cần component riêng vì hook phải
 * chạy bên trong Provider.
 */
function ExamEditorMount() {
  const ctx = useExamPreview();
  if (!ctx) return null;
  // V8.22: modal CHỈ render khi mode='modal'. mode='inline' để Studio panel
  // swap content thay (giống Doc/Note pattern). Modal X → back to inline.
  return (
    <ExamEditorDialog
      examId={ctx.examId}
      open={ctx.examId != null && ctx.mode === 'modal'}
      onOpenChange={(o) => {
        if (!o) ctx.setMode('inline'); // back to inline preview
      }}
      onChanged={() => ctx.bumpExamsVersion()}
    />
  );
}

/**
 * ExamUrlBridge — V8.24: đọc query `?examPreview=<id>` và auto-open exam
 * trong Studio. Dùng khi user redirect từ /exams/[id] (legacy) hoặc /join.
 * Sau khi open, clear query để không re-trigger khi user navigate trong-page.
 */
function ExamUrlBridge() {
  const ctx = useExamPreview();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const examPreviewId = searchParams.get('examPreview');

  React.useEffect(() => {
    if (!ctx || !examPreviewId) return;
    ctx.open(examPreviewId);
    // Clear query param sau khi open — tránh re-trigger khi user nav back/forward
    const params = new URLSearchParams(searchParams.toString());
    params.delete('examPreview');
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    // ESLint exhaustive-deps: ctx.open ổn định (useCallback), bỏ qua deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examPreviewId]);

  return null;
}

/**
 * MobileTabButton — 3-tab segment cho mobile workspace (Nguồn / Trò chuyện
 * / Studio), giống NotebookLM mobile.
 */
function MobileTabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

type Workspace = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

type Document = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  createdAt: string;
  pageCount: number | null;
  chunks: number;
};

const SOURCES_COOKIE = 'cogniva.ws-sources-open';
const STUDIO_COOKIE = 'cogniva.ws-studio-open';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type Props = {
  workspace: Workspace;
  documents: Document[];
  /** Cookie-read ở server: tránh flicker desktop. Default true nếu chưa set. */
  initialSourcesOpen: boolean;
  initialStudioOpen: boolean;
};

export function WorkspaceNotebook({
  workspace,
  documents,
  initialSourcesOpen,
  initialStudioOpen,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(workspace.name);
  const [description, setDescription] = React.useState(workspace.description ?? '');
  const [saving, setSaving] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  // Panel state — shared cho cả desktop (inline collapse) + mobile (drawer)
  const [sourcesOpen, setSourcesOpenState] = React.useState(initialSourcesOpen);
  const [studioOpen, setStudioOpenState] = React.useState(initialStudioOpen);
  /**
   * V8.18: mobile dùng 3-tab inline (giống NotebookLM) thay vì drawer.
   * Default 'chat' — user thường vào workspace để chat. Desktop ignore.
   */
  const [mobileTab, setMobileTab] = React.useState<
    'sources' | 'chat' | 'studio'
  >('chat');

  const setSourcesOpen = React.useCallback((next: boolean) => {
    setSourcesOpenState(next);
    try {
      document.cookie = `${SOURCES_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    } catch {
      /* ignore */
    }
  }, []);

  const setStudioOpen = React.useCallback((next: boolean) => {
    setStudioOpenState(next);
    try {
      document.cookie = `${STUDIO_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    } catch {
      /* ignore */
    }
  }, []);

  const save = async () => {
    if (!name.trim()) {
      toast.error('Cần tên workspace');
      return;
    }
    setSaving(true);
    try {
      await apiSend(`/api/workspaces/${workspace.id}`, 'PATCH', {
        name: name.trim(),
        description: description.trim() || null,
      });
      toast.success('Đã lưu');
      setEditing(false);
      router.refresh();
    } catch (err) {
      toast.error('Lưu thất bại: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Xoá workspace "${workspace.name}"?`,
      description: 'Mọi document bên trong sẽ bị xoá cascade.',
      confirmLabel: 'Xoá',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiSend(`/api/workspaces/${workspace.id}`, 'DELETE');
      toast.success('Đã xoá');
      router.push('/workspaces');
    } catch (err) {
      toast.error('Xoá thất bại: ' + (err as Error).message);
    }
  };

  const docIds = React.useMemo(() => documents.map((d) => d.id), [documents]);

  return (
    <NotebookProvider initialDocIds={docIds}>
      <AtomPreviewProvider>
      <NotePreviewProvider>
      <ExamPreviewProvider>
      <DocPreviewProvider supportInline>
      <div className="flex h-full flex-col overflow-hidden">
        {/* ── Compact header (V6) — 1 dòng (40px), edit/delete trong dropdown ─── */}
        <header className="shrink-0 border-b bg-background px-3">
          {editing ? (
            <div className="space-y-2 py-2">
              <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tên workspace"
                  className="h-8"
                  autoFocus
                />
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mô tả (optional)"
                  className="h-8"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Lưu
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setName(workspace.name);
                    setDescription(workspace.description ?? '');
                  }}
                >
                  Huỷ
                </Button>
                <Label className="sr-only" htmlFor="">
                  edit fields
                </Label>
              </div>
            </div>
          ) : (
            <div className="flex h-11 items-center gap-2">
              {/* Toggle Sources — desktop only (mobile dùng 3-tab) */}
              <button
                onClick={() => setSourcesOpen(!sourcesOpen)}
                className={cn(
                  'hidden h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors lg:inline-flex',
                  sourcesOpen
                    ? 'text-foreground hover:bg-muted'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                aria-label={sourcesOpen ? 'Ẩn Sources' : 'Hiện Sources'}
                title={sourcesOpen ? 'Ẩn Sources' : 'Hiện Sources'}
              >
                <PanelLeft className="h-4 w-4" />
              </button>

              {/* Breadcrumb compact + title inline */}
              <nav
                aria-label="Breadcrumb"
                className="flex min-w-0 items-center gap-1 text-sm"
              >
                <Link
                  href="/workspaces"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  Workspaces
                </Link>
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                <span
                  className="truncate font-semibold tracking-tight"
                  title={workspace.name}
                >
                  {workspace.name}
                </span>
                {workspace.description && (
                  <span
                    className="hidden truncate text-xs text-muted-foreground md:inline"
                    title={workspace.description}
                  >
                    · {workspace.description}
                  </span>
                )}
                <span className="hidden shrink-0 text-[11px] text-muted-foreground/70 lg:inline">
                  · <RelativeTime date={workspace.createdAt} />
                </span>
              </nav>

              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Tuỳ chọn workspace"
                      title="Tuỳ chọn"
                      // V8.16: Radix auto-id có thể mismatch SSR↔CSR khi
                      // upstream tree shift (do useEffect setState sau
                      // hydration). Suppress để dev overlay không spam —
                      // ID chỉ dùng cho aria, không affect functionality.
                      suppressHydrationWarning
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(true)}>
                      <Edit2 className="mr-2 h-3.5 w-3.5" />
                      Sửa workspace
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={remove}
                      className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Xoá workspace
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Toggle Studio — desktop only (mobile dùng 3-tab) */}
                <button
                  onClick={() => setStudioOpen(!studioOpen)}
                  className={cn(
                    'hidden h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors lg:inline-flex',
                    studioOpen
                      ? 'text-foreground hover:bg-muted'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  aria-label={studioOpen ? 'Ẩn Studio' : 'Hiện Studio'}
                  title={studioOpen ? 'Ẩn Studio' : 'Hiện Studio'}
                >
                  <PanelRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </header>

        {/* V8.18: Mobile tab bar (lg:hidden) — 3 tab Sources / Chat / Studio
            kiểu NotebookLM. Click tab → swap content full-width. */}
        <nav className="shrink-0 border-b bg-background lg:hidden">
          <div className="flex">
            <MobileTabButton
              active={mobileTab === 'sources'}
              onClick={() => setMobileTab('sources')}
              label="Nguồn"
            />
            <MobileTabButton
              active={mobileTab === 'chat'}
              onClick={() => setMobileTab('chat')}
              label="Trò chuyện"
            />
            <MobileTabButton
              active={mobileTab === 'studio'}
              onClick={() => setMobileTab('studio')}
              label="Studio"
            />
          </div>
        </nav>

        {/* ── 3-col layout — desktop inline collapse; mobile = active tab only ─── */}
        <div className="relative flex flex-1 overflow-hidden">
          {/* Sources — V8.18.4: UNMOUNT khi đóng (parallel với RightSidebar fix). */}
          {(sourcesOpen || mobileTab === 'sources') && (
            <div
              className={cn(
                'shrink-0 overflow-hidden',
                mobileTab === 'sources'
                  ? 'flex w-full flex-1 lg:w-auto lg:flex-none'
                  : 'hidden lg:block',
                sourcesOpen && 'lg:w-[320px]',
              )}
            >
              <div className="h-full w-full">
                <SourcesPanel
                  workspaceId={workspace.id}
                  documents={documents}
                  onUploadClick={() => setUploadOpen(true)}
                />
              </div>
            </div>
          )}

          {/* Main — desktop: flex-1; mobile: full khi tab='chat'.
              V8.18.5 ROOT-CAUSE FIX: bỏ `flex` keyword khỏi class — `flex`
              biến Main thành flex CONTAINER, làm ChatView (child) chỉ
              dùng intrinsic width (~max-w-5xl 1024px) thay vì fill 100%.
              Chỉ giữ `flex-1` (flex ITEM property, parent là flex row). */}
          <div
            className={cn(
              'min-w-0 overflow-hidden',
              mobileTab === 'chat'
                ? 'flex-1'
                : 'hidden lg:block lg:flex-1',
            )}
          >
            <MainPanel
              workspaceId={workspace.id}
              workspaceName={workspace.name}
            />
          </div>

          {/* Right column: chỉ Studio (V8.4) — desktop inline; mobile full khi tab='studio' */}
          <RightSidebar
            studioOpen={studioOpen}
            setStudioOpen={setStudioOpen}
            workspaceId={workspace.id}
            mobileActive={mobileTab === 'studio'}
          />
        </div>
      </div>
      {/* DocPreview modal (V8.7) — portal ở body root, auto-open khi citation
          set. KHÔNG ảnh hưởng tới 3-col layout, mount 1 lần ở đây để dùng
          context. */}
      <DocPreviewPanel />
      {/* V8.21: ExamEditorDialog mount qua context — mở khi user click exam
          trong Sources hoặc sau khi tạo exam mới. */}
      <ExamEditorMount />
      {/* V8.24: query `?examPreview=` auto-open exam (redirect từ legacy
          /exams/[id], /join, atom-detail…). Clear param sau khi open. */}
      <ExamUrlBridge />
      {/* V8.25: recipe overlay — Session/Flashcard/Quiz/AtomGuide/MindMap/
          Briefing render dưới dạng modal trên top chat, không swap main
          panel nữa. mainView != 'chat' → mở; Esc/X → đóng về chat. */}
      <RecipeOverlay workspaceId={workspace.id} />
      </DocPreviewProvider>
      </ExamPreviewProvider>
      </NotePreviewProvider>
      </AtomPreviewProvider>

      {/* Upload dialog controlled — SCOPED vào workspace hiện tại (không hiện picker). */}
      <UploadDocumentDialog
        workspaceId={workspace.id}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => router.refresh()}
      />
    </NotebookProvider>
  );
}
