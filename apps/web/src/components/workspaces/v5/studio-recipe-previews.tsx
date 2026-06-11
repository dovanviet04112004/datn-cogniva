'use client';

import * as React from 'react';
import {
  BrainCircuit,
  Clock,
  FileText,
  Layers,
  ListChecks,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Network,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';
import { useNotebook } from './notebook-context';
import { FlashcardManageList, QuestionManageList } from './views/manage-lists';

type ShellProps = {
  title: string;
  icon: LucideIcon;
  subtitle?: string;
  children: React.ReactNode;
};

function StudioPreviewShell({ title, icon: Icon, subtitle, children }: ShellProps) {
  const { setMainView, setRecipeMode } = useNotebook();

  return (
    <aside className="bg-card flex h-full flex-col overflow-hidden border-l">
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Icon className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold tracking-tight">{title}</p>
            {subtitle && (
              <p className="text-muted-foreground mt-0.5 truncate text-[11px]">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setRecipeMode('modal')}
            aria-label="Mở rộng modal"
            title="Mở rộng (full screen)"
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMainView('chat')}
            aria-label="Đóng — quay lại Studio"
            title="Đóng"
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 text-[12px]">{children}</div>
    </aside>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="bg-card rounded-lg border p-2.5">
      <div className="text-muted-foreground flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider">
        {Icon && <Icon className="h-2.5 w-2.5" />}
        {label}
      </div>
      <p className="mt-0.5 font-mono text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
    </div>
  );
}

function extractSnippet(markdown: string | undefined, maxLen: number): string {
  if (!markdown) return '';
  const cleaned = markdown
    .replace(/^#+\s.+$/gm, '')
    .replace(/[*_`]/g, '')
    .trim();
  return cleaned.slice(0, maxLen) + (cleaned.length > maxLen ? '…' : '');
}

type FlashcardStats = {
  due: number;
  total: number;
  byState: Record<string, number>;
};

export function StudioFlashcardPreview({ workspaceId }: { workspaceId: string }) {
  const { selectedAtoms } = useNotebook();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = React.useState(false);

  const {
    data: stats,
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: qk.workspaceRecipe(workspaceId, 'flashcard'),
    queryFn: async () => {
      const [statsData, queueData] = await Promise.all([
        apiGet<{ byState: Record<string, number>; dueToday: number }>('/api/flashcards/stats'),
        apiGet<{ flashcards: Array<unknown> }>(
          `/api/flashcards/queue?workspaceId=${workspaceId}&limit=100`,
        ),
      ]);
      const total =
        (statsData.byState?.NEW ?? 0) +
        (statsData.byState?.LEARNING ?? 0) +
        (statsData.byState?.REVIEW ?? 0) +
        (statsData.byState?.RELEARNING ?? 0);
      return {
        due: queueData.flashcards?.length ?? 0,
        total,
        byState: statsData.byState ?? {},
      } as FlashcardStats;
    },
  });

  const genForSelected = async () => {
    const atomIds = Array.from(selectedAtoms);
    if (atomIds.length === 0) {
      toast.error('Chọn atom ở cột trái (Sources → Atoms) rồi tạo');
      return;
    }
    setGenerating(true);
    try {
      const results = await Promise.all(
        atomIds.map((conceptId) =>
          apiSend<{ created: number; remaining?: number }>('/api/flashcards/generate', 'POST', {
            conceptId,
            type: 'BASIC',
            coverAll: true,
          }).catch(() => ({ created: 0, remaining: 0 })),
        ),
      );
      const created = results.reduce((s, r) => s + (r.created ?? 0), 0);
      const remaining = results.reduce((s, r) => s + (r.remaining ?? 0), 0);
      toast.success(
        created > 0
          ? `Tạo ${created} thẻ cho ${atomIds.length} atom` +
              (remaining > 0 ? ` · còn ${remaining} phần, bấm tạo tiếp` : '')
          : 'Các atom đã chọn đã có đủ thẻ rồi',
      );
      void refetch();
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'sources'] });
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'manage'] });
    } catch (e) {
      toast.error('Tạo thẻ lỗi: ' + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <StudioPreviewShell
      title="Ôn flashcard"
      icon={BrainCircuit}
      subtitle="FSRS spaced repetition · scope workspace"
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <StatCard icon={Target} label="Đến hạn" value={stats?.due ?? 0} hint="ôn ngay" />
            <StatCard icon={Layers} label="Tổng" value={stats?.total ?? 0} hint="của bạn" />
          </div>

          <div className="bg-muted/30 rounded-md border p-2.5">
            <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
              Phân loại
            </h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(stats?.byState ?? {}).map(([state, n]) => (
                <span
                  key={state}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px]',
                    state === 'NEW' && 'bg-blue-500/10 text-blue-600',
                    state === 'LEARNING' && 'bg-warning/10 text-warning',
                    state === 'REVIEW' && 'bg-success/10 text-success',
                    state === 'RELEARNING' && 'bg-destructive/10 text-destructive',
                  )}
                >
                  {state}: {n}
                </span>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={genForSelected}
            disabled={generating}
            className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-[11px] font-medium transition-colors disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {selectedAtoms.size > 0
              ? `Tạo thẻ cho ${selectedAtoms.size} atom đang chọn`
              : 'Chọn atom bên trái để tạo thẻ'}
          </button>

          <FlashcardManageList workspaceId={workspaceId} />
        </div>
      )}
    </StudioPreviewShell>
  );
}

type QuizMeta = {
  questionCount: number;
  hint?: string;
};

export function StudioQuizPreview({ workspaceId }: { workspaceId: string }) {
  const { selectedAtoms } = useNotebook();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = React.useState(false);

  const {
    data: meta,
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: qk.workspaceRecipe(workspaceId, 'quiz'),
    queryFn: () =>
      apiGet<{ questions: Array<unknown>; hint?: string }>(
        `/api/workspaces/${workspaceId}/quick-quiz`,
      ).then((d) => ({ questionCount: d.questions?.length ?? 0, hint: d.hint }) as QuizMeta),
  });

  const generate = async () => {
    if (generating) return;
    const atomIds = Array.from(selectedAtoms);
    if (atomIds.length === 0) {
      toast.error('Chọn atom ở cột trái (Sources → Atoms) rồi tạo');
      return;
    }
    setGenerating(true);
    try {
      let total = 0;
      let remaining = 0;
      await Promise.all(
        atomIds.map((conceptId) =>
          apiSend<{ questions?: unknown[]; remaining?: number }>('/api/quiz/generate', 'POST', {
            conceptId,
            types: ['MCQ', 'TRUE_FALSE'],
            coverAll: true,
          })
            .then((r) => {
              total += r.questions?.length ?? 0;
              remaining += r.remaining ?? 0;
            })
            .catch(() => {}),
        ),
      );
      toast.success(
        total > 0
          ? `Tạo ${total} câu cho ${atomIds.length} atom` +
              (remaining > 0 ? ` · còn ${remaining} phần, bấm tạo tiếp` : '')
          : 'Atom đã chọn có thể đã đủ câu hỏi',
      );
      void refetch();
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'sources'] });
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'manage'] });
    } catch (err) {
      toast.error('Gen quiz lỗi: ' + (err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <StudioPreviewShell
      title="Quick Quiz"
      icon={ListChecks}
      subtitle="5 câu random · ephemeral grade"
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          <StatCard
            icon={ListChecks}
            label="Câu hỏi sẵn sàng"
            value={meta?.questionCount ?? 0}
            hint={meta?.hint === 'no-atoms' ? 'Cần atom trước' : 'từ atom workspace'}
          />

          {meta?.hint === 'no-atoms' && (
            <p className="border-warning/30 bg-warning/5 text-warning rounded-md border p-2 text-[11px]">
              Workspace chưa có atom. Upload doc + đợi AI extract (~30-60s).
            </p>
          )}

          {meta?.hint !== 'no-atoms' && (
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {generating
                ? 'Đang tạo…'
                : selectedAtoms.size > 0
                  ? `Tạo quiz cho ${selectedAtoms.size} atom đang chọn`
                  : 'Chọn atom bên trái để tạo quiz'}
            </button>
          )}

          <div className="bg-muted/30 rounded-md border p-2.5">
            <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
              Cơ chế
            </h3>
            <ul className="text-foreground/90 mt-1 list-disc space-y-0.5 pl-4 text-[11px]">
              <li>MCQ / True-False sinh theo atom đang chọn</li>
              <li>Grade ngay khi submit; lưu lịch sử → biết câu nào đã làm</li>
              <li>Update mastery atom qua applyAttempt</li>
            </ul>
          </div>

          <QuestionManageList workspaceId={workspaceId} />
        </div>
      )}
    </StudioPreviewShell>
  );
}

type GuideData = {
  markdown: string;
  generatedAt: string;
  atomCount: number;
  fromCache: boolean;
};

export function StudioAtomGuidePreview({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const [regenerating, setRegenerating] = React.useState(false);

  const { data, isLoading: loading } = useQuery({
    queryKey: qk.workspaceRecipe(workspaceId, 'atom-guide'),
    queryFn: () => apiGet<GuideData>(`/api/workspaces/${workspaceId}/atom-guide`),
  });

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const json = await apiGet<GuideData>(
        `/api/workspaces/${workspaceId}/atom-guide?regenerate=1`,
      );
      qc.setQueryData(qk.workspaceRecipe(workspaceId, 'atom-guide'), json);
    } catch (err) {
      toast.error('Load guide lỗi: ' + (err as Error).message);
    } finally {
      setRegenerating(false);
    }
  };

  const snippet = React.useMemo(() => extractSnippet(data?.markdown, 220), [data]);

  return (
    <StudioPreviewShell
      title="Atom Guide"
      icon={FileText}
      subtitle="Markdown study guide · cache 24h"
    >
      {loading ? (
        <div className="space-y-2">
          <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />
          <div className="bg-muted h-3 w-full animate-pulse rounded" />
          <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
          <p className="text-muted-foreground mt-2 text-center text-[11px]">
            AI đang tổng kết… (~10-30s)
          </p>
        </div>
      ) : !data ? (
        <p className="text-muted-foreground text-center text-[11px]">
          Không load được. Bấm Regenerate.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <StatCard icon={Layers} label="Atom" value={data.atomCount} />
            <StatCard
              icon={Clock}
              label="Cache"
              value={data.fromCache ? '24h' : 'Mới'}
              hint={new Date(data.generatedAt).toLocaleDateString('vi-VN')}
            />
          </div>

          {snippet && (
            <div className="bg-muted/30 rounded-md border p-2.5">
              <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                Preview
              </h3>
              <p className="text-foreground/90 mt-1 line-clamp-6 text-[11px] leading-relaxed">
                {snippet}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={regenerate}
            disabled={regenerating || loading}
            className="bg-card text-muted-foreground hover:bg-muted flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50"
          >
            {regenerating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {regenerating ? 'Đang gen…' : 'Regenerate'}
          </button>
        </div>
      )}
    </StudioPreviewShell>
  );
}

type GraphStats = {
  nodes: number;
  edges: number;
};

export function StudioMindMapPreview({ workspaceId }: { workspaceId: string }) {
  const { data: graph, isLoading: loading } = useQuery({
    queryKey: qk.graph(workspaceId),
    queryFn: () =>
      apiGet<{ nodes?: Array<unknown>; edges?: Array<unknown> }>(
        `/api/graph?workspaceId=${workspaceId}`,
      ),
  });
  const stats: GraphStats | null = graph
    ? { nodes: graph.nodes?.length ?? 0, edges: graph.edges?.length ?? 0 }
    : null;

  return (
    <StudioPreviewShell title="Mind map" icon={Network} subtitle="Graph atom workspace">
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <StatCard icon={Layers} label="Atom" value={stats?.nodes ?? 0} hint="node" />
            <StatCard
              icon={Network}
              label="Cạnh"
              value={stats?.edges ?? 0}
              hint="prereq / related"
            />
          </div>

          {(stats?.nodes ?? 0) === 0 && (
            <p className="border-warning/30 bg-warning/5 text-warning rounded-md border p-2 text-[11px]">
              Workspace chưa có atom — upload doc + đợi AI extract.
            </p>
          )}

          <div className="bg-muted/30 rounded-md border p-2.5">
            <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
              Trong modal
            </h3>
            <ul className="text-foreground/90 mt-1 list-disc space-y-0.5 pl-4 text-[11px]">
              <li>Toggle scope: workspace này / tất cả</li>
              <li>Dagre hierarchical layout (connected)</li>
              <li>Grid theo domain cho atom mồ côi</li>
              <li>Click atom → xem detail + master path</li>
            </ul>
          </div>
        </div>
      )}
    </StudioPreviewShell>
  );
}

type BriefingData = {
  markdown: string;
  generatedAt: string;
  docCount: number;
  fromCache: boolean;
};

export function StudioBriefingPreview({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const [regenerating, setRegenerating] = React.useState(false);

  const { data, isLoading: loading } = useQuery({
    queryKey: qk.workspaceRecipe(workspaceId, 'briefing'),
    queryFn: () => apiGet<BriefingData>(`/api/workspaces/${workspaceId}/briefing`),
  });

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const json = await apiGet<BriefingData>(
        `/api/workspaces/${workspaceId}/briefing?regenerate=1`,
      );
      qc.setQueryData(qk.workspaceRecipe(workspaceId, 'briefing'), json);
    } catch (err) {
      toast.error('Load briefing lỗi: ' + (err as Error).message);
    } finally {
      setRegenerating(false);
    }
  };

  const snippet = React.useMemo(() => extractSnippet(data?.markdown, 240), [data]);

  return (
    <StudioPreviewShell
      title="Briefing Doc"
      icon={MapIcon}
      subtitle="200-300 từ tóm tắt · cache 24h"
    >
      {loading ? (
        <div className="space-y-2">
          <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />
          <div className="bg-muted h-3 w-full animate-pulse rounded" />
          <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
          <p className="text-muted-foreground mt-2 text-center text-[11px]">
            AI đang đọc sources… (~5-15s)
          </p>
        </div>
      ) : !data ? (
        <p className="text-muted-foreground text-center text-[11px]">
          Không load được. Bấm Regenerate.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <StatCard icon={FileText} label="Documents" value={data.docCount} />
            <StatCard
              icon={TrendingUp}
              label="Trạng thái"
              value={data.fromCache ? 'Cache' : 'Mới'}
              hint={new Date(data.generatedAt).toLocaleDateString('vi-VN')}
            />
          </div>

          {snippet && (
            <div className="bg-muted/30 rounded-md border p-2.5">
              <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                Preview
              </h3>
              <p className="text-foreground/90 mt-1 line-clamp-6 text-[11px] leading-relaxed">
                {snippet}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={regenerate}
            disabled={regenerating || loading}
            className="bg-card text-muted-foreground hover:bg-muted flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50"
          >
            {regenerating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {regenerating ? 'Đang gen…' : 'Regenerate'}
          </button>
        </div>
      )}
    </StudioPreviewShell>
  );
}
