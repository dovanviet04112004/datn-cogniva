/**
 * RelatedDocsSection — Bonus #10 Auto-Stitched Workspace (Phase 2, 2026-05-27).
 *
 * Hiển thị 3 doc bổ trợ với role: prerequisite + next_step + practice.
 * User chọn doc nào muốn thêm (default check all 3) + 1-click bulk-import vào
 * workspace chọn từ dropdown — bao gồm cả doc gốc.
 *
 * Spec: docs/plans/library-share.md §Bonus 10.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  CheckCircle2,
  Layers,
  Loader2,
  Package,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
// SectionHeading dùng chung toàn app — thay khối tiêu đề mục cũ
// (gạch gradient + nhãn eyebrow uppercase + count).
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

type RelatedDoc = {
  id: string;
  title: string;
  docType: string;
  pageCount: number | null;
  previewThumbUrl: string | null;
  aiSummary: string | null;
  ratingAvg: number | null;
  qualityScore: number | null;
  workspaceImportCount: number;
  role: 'prerequisite' | 'next_step' | 'practice';
  atomOverlap: number;
};

type Workspace = { id: string; name: string };

const ROLE_META: Record<
  RelatedDoc['role'],
  { labelKey: string; emoji: string; color: string; icon: LucideIcon }
> = {
  prerequisite: {
    labelKey: 'library.related.role.prerequisite',
    emoji: '📚',
    color: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
    icon: BookOpen,
  },
  next_step: {
    labelKey: 'library.related.role.next_step',
    emoji: '🎯',
    color: 'bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300',
    icon: Target,
  },
  practice: {
    labelKey: 'library.related.role.practice',
    emoji: '⚡',
    color: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
    icon: CheckCircle2,
  },
};

export function RelatedDocsSection({
  sourceDocId,
  sourceTitle,
}: {
  sourceDocId: string;
  sourceTitle: string;
}) {
  const t = useT();
  const router = useRouter();
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = React.useState(false);
  const [selectedWsId, setSelectedWsId] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);

  // Related docs — fetch on mount qua React Query.
  const { data: related = [], isLoading: loading } = useQuery({
    queryKey: qk.libraryDocRelated(sourceDocId),
    queryFn: () =>
      apiGet<{ related: RelatedDoc[] }>(
        `/api/library/docs/${sourceDocId}/related`,
      ).then((d) => d.related),
  });

  // Khi related load xong → default chọn hết.
  React.useEffect(() => {
    if (related.length > 0) setSelectedIds(new Set(related.map((r) => r.id)));
  }, [related]);

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Workspaces list (chỉ fetch khi mở dialog) — key dùng chung qk.workspaces().
  const { data: workspaces = [], isLoading: wsLoading } = useQuery({
    queryKey: qk.workspaces(),
    queryFn: () =>
      apiGet<{ workspaces: Workspace[] }>('/api/workspaces').then(
        (d) => d.workspaces,
      ),
    enabled: importOpen,
  });

  // Auto-chọn workspace đầu khi list load.
  React.useEffect(() => {
    if (workspaces.length > 0 && !selectedWsId) setSelectedWsId(workspaces[0]!.id);
  }, [workspaces, selectedWsId]);

  const doBulkImport = async () => {
    if (!selectedWsId) {
      toast.error(t('library.related.choose_ws'));
      return;
    }
    // Always include source + selected related
    const ids = [sourceDocId, ...Array.from(selectedIds)];
    setImporting(true);
    try {
      const data = await apiSend<{
        imported: number;
        skipped: number;
        failed: number;
      }>('/api/library/import-batch', 'POST', {
        workspaceId: selectedWsId,
        docIds: ids,
      });
      toast.success(
        `${t('library.related.imported').replace('{imported}', String(data.imported))}${
          data.skipped ? t('library.related.skipped').replace('{skipped}', String(data.skipped)) : ''
        }${data.failed ? t('library.related.failed').replace('{failed}', String(data.failed)) : ''}`,
      );
      setImportOpen(false);
      router.push(`/workspaces/${selectedWsId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <section className="mt-8 space-y-3">
        <SectionHeading>{t('library.related.section_title')}</SectionHeading>
        <div className="rounded-xl border border-divider bg-card p-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
          {t('library.related.analyzing')}
        </div>
      </section>
    );
  }

  if (related.length === 0) {
    return null;
  }

  const allSelected = selectedIds.size === related.length;
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(related.map((r) => r.id)));
  };

  return (
    <section className="mt-8 space-y-3">
      {/* Tiêu đề mục + nút chọn/bỏ chọn tất cả nằm slot action bên phải. */}
      <SectionHeading
        count={related.length}
        action={
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] font-medium text-discovery-600 hover:text-discovery-700 dark:text-discovery-300"
          >
            {allSelected ? t('library.related.deselect_all') : t('library.related.select_all')}
          </button>
        }
      >
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-discovery-600" />
          {t('library.related.section_title')}
        </span>
      </SectionHeading>
      <p className="text-[12px] text-muted-foreground">
        {t('library.related.subtitle')}
      </p>

      <ul className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
        {related.map((r) => {
          const meta = ROLE_META[r.role];
          const Icon = meta.icon;
          const selected = selectedIds.has(r.id);
          return (
            <li key={r.id}>
              <label
                className={cn(
                  'group flex h-full cursor-pointer flex-col gap-2 rounded-xl border p-3 transition-all',
                  selected
                    ? 'border-discovery-500 bg-discovery-500/5 shadow-sm'
                    : 'border-divider bg-card hover:border-discovery-500/40 hover:bg-discovery-500/5',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider',
                      meta.color,
                    )}
                  >
                    <Icon className="h-2.5 w-2.5" />
                    {t(meta.labelKey)}
                  </span>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleId(r.id)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-discovery-600"
                  />
                </div>
                <p className="line-clamp-2 text-[12.5px] font-semibold leading-snug">
                  {r.title}
                </p>
                {r.atomOverlap > 0 ? (
                  <p className="text-[10.5px] font-medium text-discovery-700 dark:text-discovery-300">
                    {t('library.related.atom_overlap').replace('{count}', String(r.atomOverlap))}
                  </p>
                ) : (
                  <p className="text-[10.5px] text-muted-foreground/70">
                    {t('library.related.same_subject')}
                  </p>
                )}
                <div className="mt-auto flex items-center justify-between text-[10.5px] text-muted-foreground">
                  <span>{r.pageCount ?? '–'} {t('library.related.page_unit')}</span>
                  {r.qualityScore != null && r.qualityScore > 0 && (
                    <span className="font-mono tabular-nums">
                      Q {Number(r.qualityScore).toFixed(0)}
                    </span>
                  )}
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogTrigger asChild>
          <Button className="mt-2 w-full" disabled={selectedIds.size === 0}>
            <Package className="mr-1.5 h-4 w-4" />
            {t('library.related.add_to_ws')
              .replace('{total}', String(selectedIds.size + 1))
              .replace('{related}', String(selectedIds.size))}
            <Layers className="ml-1.5 h-3.5 w-3.5 opacity-60" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('library.related.choose_ws_title').replace('{count}', String(selectedIds.size + 1))}
            </DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-muted-foreground">
            {t('library.related.will_add')} <strong>{sourceTitle}</strong>
            {selectedIds.size > 0 && (
              <>
                {' '}
                {t('library.related.plus_docs').replace('{count}', String(selectedIds.size))}
              </>
            )}
            .
          </p>
          {wsLoading ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              {t('library.related.loading_ws')}
            </p>
          ) : workspaces.length === 0 ? (
            <div className="py-2">
              <p className="text-[13px] text-muted-foreground">
                {t('library.related.no_ws')}
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5 py-1">
              {workspaces.map((ws) => (
                <li key={ws.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedWsId(ws.id)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] transition-colors',
                      selectedWsId === ws.id
                        ? 'border-primary/40 bg-primary/5 font-semibold text-primary'
                        : 'border-divider hover:bg-muted',
                    )}
                  >
                    <span>{ws.name}</span>
                    {selectedWsId === ws.id && <span>✓</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            onClick={doBulkImport}
            disabled={!selectedWsId || importing || workspaces.length === 0}
            className="mt-2 w-full"
          >
            {importing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {t('library.related.bulk_import').replace('{count}', String(selectedIds.size + 1))}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
