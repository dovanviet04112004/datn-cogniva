'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Ban,
  ChevronRight,
  Eye,
  Loader2,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import type { AdminRole } from '@cogniva/db';
import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';

import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { cn } from '@/lib/utils';

type Report = {
  id: string;
  reporterId: string;
  reporterName: string | null;
  reporterEmail: string | null;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  resolvedBy: string | null;
  resolverName: string | null;
  resolverEmail: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
};

type Resolution = 'dismiss' | 'takedown' | 'warn' | 'ban';

export function ReportsListClient({ adminRole }: { adminRole: AdminRole }) {
  const router = useRouter();
  const canMutate = adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN';

  const [status, setStatus] = React.useState<'PENDING' | 'RESOLVED'>('PENDING');
  const [targetType, setTargetType] = React.useState<string>('');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const [activeReport, setActiveReport] = React.useState<Report | null>(null);
  const [activeResolution, setActiveResolution] = React.useState<Resolution | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);

  const buildQuery = (cursorParam?: string) => {
    const p = new URLSearchParams();
    p.set('status', status);
    if (targetType) p.set('targetType', targetType);
    if (cursorParam) p.set('cursor', cursorParam);
    p.set('limit', '50');
    return p.toString();
  };

  type Page = { reports: Report[]; nextCursor: string | null; pendingCount: number };
  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: qk.adminReports(status, targetType),
    queryFn: ({ pageParam }) =>
      apiGet<Page>(`/api/admin/moderation/reports?${buildQuery(pageParam ?? undefined)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const reports = React.useMemo(() => data?.pages.flatMap((p) => p.reports) ?? [], [data]);
  const pendingCount = data?.pages[0]?.pendingCount ?? 0;
  const loadMore = () => {
    if (hasNextPage && !loadingMore) void fetchNextPage();
  };

  const startAction = (r: Report, res: Resolution) => {
    setActiveReport(r);
    setActiveResolution(res);
  };

  const doAction = async (reason: string) => {
    if (!activeReport || !activeResolution) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/moderation/reports/${activeReport.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution: activeResolution, reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? 'Action thất bại');
      }
      toast.success(`Đã ${activeResolution.toUpperCase()} report`);
      setActiveReport(null);
      setActiveResolution(null);
      void refetch();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Moderation reports</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-red-300 ring-1 ring-inset ring-red-500/30">
            <AlertTriangle className="h-3 w-3" />
            {pendingCount} pending
          </span>
        </div>
        <p className="text-sm text-slate-400">
          Reports do user gửi qua nút &quot;Report&quot; trên message / user / document. Resolve để
          đóng case + ghi audit.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={status === 'PENDING'} onClick={() => setStatus('PENDING')}>
          Pending ({pendingCount})
        </FilterChip>
        <FilterChip active={status === 'RESOLVED'} onClick={() => setStatus('RESOLVED')}>
          Resolved
        </FilterChip>
        <span className="mx-1 h-4 w-px bg-slate-800" />
        <FilterChip active={targetType === ''} onClick={() => setTargetType('')}>
          Mọi target
        </FilterChip>
        {['message', 'user', 'document', 'conversation', 'group'].map((t) => (
          <FilterChip key={t} active={targetType === t} onClick={() => setTargetType(t)}>
            {t}
          </FilterChip>
        ))}
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="py-12 text-center text-slate-500">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 py-12 text-center text-xs text-slate-500">
            {status === 'PENDING'
              ? 'Không có report nào đang chờ xử lý.'
              : 'Chưa có report đã resolve.'}
          </div>
        ) : (
          reports.map((r) => (
            <ReportCard
              key={r.id}
              r={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
              canMutate={canMutate}
              onAction={(res) => startAction(r, res)}
            />
          ))
        )}
      </div>

      {hasNextPage && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800',
              loadingMore && 'opacity-50',
            )}
          >
            {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Tải thêm
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!activeReport && !!activeResolution}
        onOpenChange={(o) => {
          if (!o) {
            setActiveReport(null);
            setActiveResolution(null);
          }
        }}
        title={activeResolution ? `${resolutionLabel(activeResolution)} report?` : ''}
        description={
          activeReport && activeResolution ? (
            <span>
              Target: <strong>{activeReport.targetType}</strong>:{' '}
              <code className="text-[11px]">{activeReport.targetId.slice(0, 12)}</code>
              <br />
              {resolutionDescription(activeResolution, activeReport.targetType)}
            </span>
          ) : null
        }
        confirmLabel={activeResolution ? resolutionLabel(activeResolution) : ''}
        variant={
          activeResolution === 'dismiss'
            ? 'default'
            : activeResolution === 'warn'
              ? 'warning'
              : 'destructive'
        }
        loading={actionLoading}
        onConfirm={doAction}
      />
    </div>
  );
}

function ReportCard({
  r,
  expanded,
  onToggle,
  canMutate,
  onAction,
}: {
  r: Report;
  expanded: boolean;
  onToggle: () => void;
  canMutate: boolean;
  onAction: (res: Resolution) => void;
}) {
  const isResolved = r.status === 'RESOLVED';
  return (
    <article
      className={cn(
        'rounded-lg border bg-slate-900/30 transition-colors',
        expanded ? 'border-red-500/30' : 'border-slate-800/60 hover:border-slate-700',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-500/10 ring-1 ring-inset ring-red-500/30">
          <AlertTriangle className="h-3.5 w-3.5 text-red-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TargetPill type={r.targetType} />
            <code className="font-mono text-[10.5px] text-slate-500">
              {r.targetId.slice(0, 12)}…
            </code>
            {isResolved && r.resolution && <ResolutionPill resolution={r.resolution} />}
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] text-slate-300">{r.reason}</p>
          <p className="mt-1 font-mono text-[10.5px] text-slate-500">
            reporter:{' '}
            <Link
              href={`/admin/users/${r.reporterId}`}
              className="text-slate-400 hover:text-slate-200"
              onClick={(e) => e.stopPropagation()}
            >
              {r.reporterEmail ?? r.reporterName ?? '—'}
            </Link>{' '}
            · {new Date(r.createdAt).toLocaleString('vi-VN')}
          </p>
        </div>
        <ChevronRight
          className={cn(
            'mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-slate-800/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
            <span>Target detail:</span>
            <TargetLink type={r.targetType} id={r.targetId} />
          </div>

          {(r.targetType === 'message' ||
            r.targetType === 'group_message' ||
            r.targetType === 'ai_message') && <ContextWindow type={r.targetType} id={r.targetId} />}

          {isResolved && (
            <div className="rounded-md bg-slate-950/50 p-2.5 text-[12px]">
              <p className="text-slate-400">
                Đã resolve{' '}
                {r.resolvedAt && (
                  <span className="font-mono text-[10.5px] text-slate-500">
                    {new Date(r.resolvedAt).toLocaleString('vi-VN')}
                  </span>
                )}{' '}
                bởi{' '}
                {r.resolvedBy ? (
                  <Link
                    href={`/admin/users/${r.resolvedBy}`}
                    className="font-mono text-[11px] text-slate-300 hover:text-red-300"
                  >
                    {r.resolverEmail ?? r.resolverName ?? '—'}
                  </Link>
                ) : (
                  '—'
                )}
              </p>
            </div>
          )}

          {!isResolved && canMutate && (
            <div className="flex flex-wrap gap-2">
              <ActionBtn icon={X} label="Dismiss" onClick={() => onAction('dismiss')} />
              <ActionBtn
                icon={Trash2}
                label="Take down"
                onClick={() => onAction('takedown')}
                variant="destructive"
              />
              <ActionBtn
                icon={ShieldAlert}
                label="Warn user"
                onClick={() => onAction('warn')}
                variant="warning"
              />
              <ActionBtn
                icon={Ban}
                label="Ban target"
                onClick={() => onAction('ban')}
                variant="destructive"
              />
            </div>
          )}
          {!isResolved && !canMutate && (
            <p className="text-[11px] text-slate-500">
              Role SUPPORT chỉ xem được — không resolve được report.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  variant = 'default',
}: {
  icon: typeof X;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'warning' | 'destructive';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
        variant === 'destructive'
          ? 'border-red-500/30 bg-red-500/5 text-red-300 hover:bg-red-500/15'
          : variant === 'warning'
            ? 'border-amber-500/30 bg-amber-500/5 text-amber-300 hover:bg-amber-500/15'
            : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800',
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function TargetPill({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-300">
      {type}
    </span>
  );
}

function ResolutionPill({ resolution }: { resolution: string }) {
  const cfg: Record<string, { cls: string; Icon: typeof X }> = {
    dismiss: { cls: 'border-slate-600/30 bg-slate-700/20 text-slate-400', Icon: X },
    takedown: { cls: 'border-red-500/30 bg-red-500/10 text-red-300', Icon: Trash2 },
    warn: { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300', Icon: ShieldAlert },
    ban: { cls: 'border-red-500/30 bg-red-500/10 text-red-300', Icon: Ban },
  };
  const c = cfg[resolution] ?? cfg.dismiss!;
  const Icon = c.Icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase',
        c.cls,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {resolution}
    </span>
  );
}

function TargetLink({ type, id }: { type: string; id: string }) {
  const map: Record<string, string> = {
    user: `/admin/users/${id}`,
    document: `/admin/documents/${id}`,
    conversation: `/admin/conversations/${id}`,
    group: `/admin/groups/${id}`,
  };
  const href = map[type];
  if (!href) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500">
        <Eye className="h-3 w-3" />
        {type}:{id.slice(0, 12)}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 font-mono text-[11px] text-red-300 hover:text-red-200"
    >
      <Eye className="h-3 w-3" />
      Xem {type}
    </Link>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'border-red-500/40 bg-red-500/10 text-red-300'
          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200',
      )}
    >
      {children}
    </button>
  );
}

function ContextWindow({ type, id }: { type: string; id: string }) {
  type ContextItem = {
    id: string;
    role?: string;
    content: string;
    createdAt: string;
    authorId?: string;
    authorName?: string | null;
    authorEmail?: string | null;
    isTarget: boolean;
  };
  type ContextData = {
    type: string;
    channelName?: string | null;
    items: ContextItem[];
  };

  const {
    data,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: qk.adminModerationContext(type, id),
    queryFn: () => apiGet<ContextData>(`/api/admin/moderation/context?type=${type}&id=${id}`),
  });

  if (loading) {
    return (
      <div className="rounded-md bg-slate-950/50 p-3 text-center">
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-500" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md bg-slate-950/50 p-3 text-[11.5px] text-slate-500">
        Không load được context: {(error as Error).message}
      </div>
    );
  }
  if (!data || data.items.length === 0) {
    return (
      <div className="rounded-md bg-slate-950/50 p-3 text-[11.5px] text-slate-500">
        Không tìm thấy context cho target này (có thể đã bị xoá).
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-800/60 bg-slate-950/50 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Context · {data.channelName ? `#${data.channelName}` : data.type}
      </p>
      <ul className="space-y-1.5">
        {data.items.map((m) => (
          <li
            key={m.id}
            className={cn(
              'rounded border px-2.5 py-1.5 text-[12px]',
              m.isTarget
                ? 'border-red-500/40 bg-red-500/5 text-slate-100'
                : 'border-slate-800/60 bg-slate-900/30 text-slate-400',
            )}
          >
            <div className="mb-0.5 flex items-center justify-between font-mono text-[10px] text-slate-500">
              <span>
                {m.isTarget && (
                  <span className="mr-1 inline-block rounded bg-red-500/20 px-1 text-[10px] uppercase tracking-wider text-red-300">
                    target
                  </span>
                )}
                {m.role ?? m.authorName ?? m.authorEmail ?? '—'}
              </span>
              <span>
                {new Date(m.createdAt).toLocaleString('vi-VN', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap break-words">{m.content}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function resolutionLabel(r: Resolution): string {
  return { dismiss: 'Dismiss', takedown: 'Take down', warn: 'Warn', ban: 'Ban' }[r];
}

function resolutionDescription(r: Resolution, targetType: string): string {
  switch (r) {
    case 'dismiss':
      return 'Đóng report mà không action gì lên target. Dùng khi report sai/duplicate.';
    case 'takedown':
      if (['document', 'message', 'conversation'].includes(targetType)) {
        return `Xoá ${targetType} (cascade — không khôi phục được).`;
      }
      return `Take down chưa hỗ trợ cho targetType=${targetType} ở Phase 2.`;
    case 'warn':
      return 'Ghi audit cảnh báo. Phase 2 follow-up sẽ trigger email warn user.';
    case 'ban':
      if (targetType === 'user') return 'Suspend user — user mất quyền sign-in.';
      if (targetType === 'group') return 'Suspend group — group ngừng hoạt động.';
      return `Ban chưa hỗ trợ cho targetType=${targetType} ở Phase 2.`;
  }
}
