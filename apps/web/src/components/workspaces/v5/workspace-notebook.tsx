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
import { ExamPreviewProvider, useExamPreview } from './exam-preview-context';
import { ExamEditorDialog } from '@/components/exams/exam-editor-dialog';
import { RecipeOverlay } from './recipe-overlay';

function RightSidebar({
  studioOpen,
  setStudioOpen: _setStudioOpen,
  workspaceId,
  mobileActive,
}: {
  studioOpen: boolean;
  setStudioOpen: (next: boolean) => void;
  workspaceId: string;
  mobileActive: boolean;
}) {
  if (!mobileActive && !studioOpen) return null;
  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden',
        mobileActive ? 'flex w-full flex-1 lg:w-auto lg:flex-none' : 'hidden lg:block',
        studioOpen && 'lg:w-[360px]',
      )}
    >
      <div className="h-full w-full">
        <StudioPanel workspaceId={workspaceId} />
      </div>
    </div>
  );
}

function ExamEditorMount() {
  const ctx = useExamPreview();
  if (!ctx) return null;
  return (
    <ExamEditorDialog
      examId={ctx.examId}
      open={ctx.examId != null && ctx.mode === 'modal'}
      onOpenChange={(o) => {
        if (!o) ctx.setMode('inline');
      }}
      onChanged={() => ctx.bumpExamsVersion()}
    />
  );
}

function ExamUrlBridge() {
  const ctx = useExamPreview();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const examPreviewId = searchParams.get('examPreview');

  React.useEffect(() => {
    if (!ctx || !examPreviewId) return;
    ctx.open(examPreviewId);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('examPreview');
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examPreviewId]);

  return null;
}

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
          : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground border-transparent',
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

  const [sourcesOpen, setSourcesOpenState] = React.useState(initialSourcesOpen);
  const [studioOpen, setStudioOpenState] = React.useState(initialStudioOpen);
  const [mobileTab, setMobileTab] = React.useState<'sources' | 'chat' | 'studio'>('chat');

  const setSourcesOpen = React.useCallback((next: boolean) => {
    setSourcesOpenState(next);
    try {
      document.cookie = `${SOURCES_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    } catch {}
  }, []);

  const setStudioOpen = React.useCallback((next: boolean) => {
    setStudioOpenState(next);
    try {
      document.cookie = `${STUDIO_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    } catch {}
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
                <header className="bg-background shrink-0 border-b px-3">
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

                      <nav
                        aria-label="Breadcrumb"
                        className="flex min-w-0 items-center gap-1 text-sm"
                      >
                        <Link
                          href="/workspaces"
                          className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                        >
                          Workspaces
                        </Link>
                        <ChevronRight className="text-muted-foreground/60 h-3 w-3 shrink-0" />
                        <span
                          className="truncate font-semibold tracking-tight"
                          title={workspace.name}
                        >
                          {workspace.name}
                        </span>
                        {workspace.description && (
                          <span
                            className="text-muted-foreground hidden truncate text-xs md:inline"
                            title={workspace.description}
                          >
                            · {workspace.description}
                          </span>
                        )}
                        <span className="text-muted-foreground/70 hidden shrink-0 text-[11px] lg:inline">
                          · <RelativeTime date={workspace.createdAt} />
                        </span>
                      </nav>

                      <div className="ml-auto flex shrink-0 items-center gap-0.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                              aria-label="Tuỳ chọn workspace"
                              title="Tuỳ chọn"
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

                <nav className="bg-background shrink-0 border-b lg:hidden">
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

                <div className="relative flex flex-1 overflow-hidden">
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

                  <div
                    className={cn(
                      'min-w-0 overflow-hidden',
                      mobileTab === 'chat' ? 'flex-1' : 'hidden lg:block lg:flex-1',
                    )}
                  >
                    <MainPanel workspaceId={workspace.id} workspaceName={workspace.name} />
                  </div>

                  <RightSidebar
                    studioOpen={studioOpen}
                    setStudioOpen={setStudioOpen}
                    workspaceId={workspace.id}
                    mobileActive={mobileTab === 'studio'}
                  />
                </div>
              </div>
              <DocPreviewPanel />
              <ExamEditorMount />
              <ExamUrlBridge />
              <RecipeOverlay workspaceId={workspace.id} />
            </DocPreviewProvider>
          </ExamPreviewProvider>
        </NotePreviewProvider>
      </AtomPreviewProvider>

      <UploadDocumentDialog
        workspaceId={workspace.id}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => router.refresh()}
      />
    </NotebookProvider>
  );
}
