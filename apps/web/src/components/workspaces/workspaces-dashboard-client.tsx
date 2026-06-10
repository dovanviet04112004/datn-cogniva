/**
 * WorkspacesDashboardClient — premium dashboard UI cho /workspaces.
 *
 * Design tenets (Linear / Vercel / Anthropic / Stripe):
 *   - RESTRAINT: zero unnecessary chrome; typography + spacing carry weight.
 *   - DEPTH BY DEFAULT: subtle shadows, layered surfaces, refined edges.
 *   - PRECISION SPACING: 4/8/12/16/24/32px rhythm, tabular-nums numerics.
 *   - AI-LEARNING IDENTITY: dot grid motif, deterministic accent per workspace
 *     (hash → hue), monospaced timestamps as forensic detail.
 *   - MICROINTERACTIONS: hover lift, chevron slide, accent stripe slide-in.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  ChevronRight,
  Edit2,
  FileText,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/use-confirm';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState } from '@/components/layout/empty-state';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RelativeTime } from '@/components/ui/relative-time';
// Tiêu đề mục dùng chung — thay bản SectionHeading hardcode cũ trong file này.
import { SectionHeading } from '@/components/ui/section-heading';
import { CreateWorkspaceDialog } from './create-workspace-dialog';

type Workspace = {
  id: string;
  name: string;
  description: string | null;
  documentCount: number;
  createdAt: string;
  lastActivityAt: string | null;
};

type RecentDoc = {
  id: string;
  filename: string;
  createdAt: string;
  workspaceId: string;
  workspaceName: string | null;
};

type Props = {
  workspaces: Workspace[];
  /** Tổng tài liệu trên tất cả workspaces — hiển thị compact ở subtitle. */
  totalDocs: number;
  recentDocs: RecentDoc[];
};

/**
 * Hash deterministic string → HSL hue (0-360). Cùng tên workspace luôn ra
 * cùng màu accent — feels intentional, không random. Khoảng 30-340 để tránh
 * red bão hoà (UI dùng red cho destructive).
 */
function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return 30 + (h % 310);
}

/** Lấy tên rút gọn cho avatar — 2 chữ cái đầu, in hoa. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function WorkspacesDashboardClient({
  workspaces,
  totalDocs,
  recentDocs,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');

  const saveRename = async (id: string) => {
    if (!editName.trim()) return;
    try {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setEditingId(null);
      router.refresh();
    } catch (err) {
      toast.error('Rename thất bại: ' + (err as Error).message);
    }
  };

  const deleteWs = async (id: string) => {
    const ok = await confirm({
      title: 'Xoá workspace này?',
      description: 'Mọi document bên trong sẽ bị xoá theo.',
      confirmLabel: 'Xoá',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `status ${res.status}`);
      }
      router.refresh();
      toast.success('Đã xoá');
    } catch (err) {
      toast.error('Xoá thất bại: ' + (err as Error).message);
    }
  };

  return (
    <PageShell
      size="wide"
      padded
      className="space-y-8"
      // Trang HUB chính của mảng tài liệu — bật hero banner aurora dùng chung.
      hero
      eyebrow="Thư viện"
      title="Thư viện tài liệu"
      description={
        workspaces.length > 0
          ? `${workspaces.length} workspace · ${totalDocs} tài liệu`
          : 'Gom tài liệu theo môn / dự án — AI Tutor sẽ giới hạn ngữ cảnh trong workspace.'
      }
      action={<CreateWorkspaceDialog onCreated={() => router.refresh()} />}
    >
      {/* ── Workspace section ──────────────────────────────── */}
      {workspaces.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Chưa có workspace"
          description={
            'Upload 1 PDF sẽ tự tạo "Default" workspace, hoặc bấm "Workspace mới" phía trên.'
          }
        />
      ) : (
        <section>
          <SectionHeading count={workspaces.length}>Workspaces</SectionHeading>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => (
              <WorkspaceCard
                key={w.id}
                workspace={w}
                isEditing={editingId === w.id}
                editName={editName}
                onEditNameChange={setEditName}
                onStartEdit={() => {
                  setEditingId(w.id);
                  setEditName(w.name);
                }}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={() => saveRename(w.id)}
                onDelete={() => deleteWs(w.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Recent documents ───────────────────────────────── */}
      {recentDocs.length > 0 && (
        <section>
          <SectionHeading
            count={recentDocs.length}
            action={
              <Link
                href="/documents"
                className="group/all inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Xem tất cả
                <ChevronRight className="h-3 w-3 transition-transform group-hover/all:translate-x-0.5" />
              </Link>
            }
          >
            Tài liệu gần đây
          </SectionHeading>
          <ul className="overflow-hidden rounded-xl border bg-card/30 shadow-soft">
            {recentDocs.map((d, i) => (
              <li key={d.id} className={cn(i > 0 && 'border-t')}>
                <Link
                  href={`/documents/${d.id}`}
                  className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">
                      {d.filename}
                    </p>
                    {d.workspaceName && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {d.workspaceName}
                      </p>
                    )}
                  </div>
                  <p className="hidden shrink-0 font-mono text-xs tabular-nums text-muted-foreground sm:block">
                    <RelativeTime date={d.createdAt} />
                  </p>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}


/**
 * WorkspaceCard — premium card với letter avatar accent, deterministic
 * hue per workspace, hover-lift, accent stripe slide-in.
 *
 * Layered surfaces:
 *   - Bottom: bg-card với border subtle
 *   - Middle: hover bg-muted/40 shift
 *   - Top: accent stripe 2px slide-in từ trái khi hover
 * Letter avatar = identity marker, dùng hue hash từ tên → cùng workspace
 * luôn ra cùng màu.
 */
function WorkspaceCard({
  workspace,
  isEditing,
  editName,
  onEditNameChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  workspace: Workspace;
  isEditing: boolean;
  editName: string;
  onEditNameChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
}) {
  const w = workspace;
  const hue = React.useMemo(() => hueFromString(w.name || w.id), [w.name, w.id]);
  const initials = React.useMemo(() => initialsOf(w.name || '??'), [w.name]);
  const docLabel = w.documentCount === 1 ? '1 tài liệu' : `${w.documentCount} tài liệu`;

  if (isEditing) {
    return (
      <div className="rounded-xl border bg-card p-5 shadow-soft">
        <input
          autoFocus
          value={editName}
          onChange={(e) => onEditNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSaveEdit();
            if (e.key === 'Escape') onCancelEdit();
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={onSaveEdit}>
            Lưu
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelEdit}>
            Hủy
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group/card relative overflow-hidden rounded-xl border bg-card shadow-soft transition-all duration-base ease-expo-out hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-elevated"
      style={
        {
          // Custom prop để accent stripe đọc — không leak vào DOM
          '--ws-hue': hue,
        } as React.CSSProperties
      }
    >
      {/* Accent stripe — bên trái, slide-in từ -translate khi hover */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] -translate-x-full bg-[hsl(var(--ws-hue)_70%_55%)] transition-transform duration-300 group-hover/card:translate-x-0"
      />

      <Link
        href={`/workspaces/${w.id}`}
        className="relative block p-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="flex min-h-[124px] flex-col gap-3">
          {/* Letter avatar with deterministic hue */}
          <div className="flex items-start justify-between gap-3">
            <div
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tracking-tight ring-1 ring-inset transition-transform duration-200 group-hover/card:scale-105"
              style={{
                backgroundColor: `hsl(${hue} 70% 55% / 0.12)`,
                color: `hsl(${hue} 60% 35%)`,
                boxShadow: `inset 0 0 0 1px hsl(${hue} 70% 55% / 0.2)`,
              }}
            >
              {initials}
            </div>
            {/* Spacer for dropdown */}
            <div className="h-7 w-7" />
          </div>

          <div className="space-y-1">
            <h3 className="line-clamp-1 pr-2 text-base font-semibold leading-tight tracking-tight">
              {w.name}
            </h3>
            {w.description ? (
              <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                {w.description}
              </p>
            ) : (
              <p className="text-sm italic text-muted-foreground/50">
                Chưa có mô tả
              </p>
            )}
          </div>

          {/* Meta footer — đẩy xuống bottom qua mt-auto */}
          <div className="mt-auto flex items-center gap-2 pt-2 text-[11px]">
            <span className="font-mono font-semibold tabular-nums text-foreground/70">
              {docLabel}
            </span>
            {w.lastActivityAt && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  <RelativeTime date={w.lastActivityAt} />
                </span>
              </>
            )}
          </div>
        </div>
      </Link>

      {/* CRUD dropdown — hover/focus reveal */}
      <div className="absolute right-3 top-3 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Tùy chọn workspace"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={onStartEdit}>
              <Edit2 className="mr-2 h-4 w-4" />
              Đổi tên
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Xoá
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
