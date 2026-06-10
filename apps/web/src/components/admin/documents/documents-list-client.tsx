/**
 * DocumentsListClient — list docs cross-user, filter + cursor pagination.
 *
 * UX:
 *   - Search debounce 300ms (filename)
 *   - Filter status chip + email substring + mime substring
 *   - Click row → /admin/documents/[id]
 *   - "Tải thêm" khi có nextCursor
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ChevronRight,
  CircleCheck,
  FileText,
  Loader2,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';

type DocStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

type DocRow = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  status: DocStatus;
  createdAt: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  workspaceId: string;
  workspaceName: string | null;
};

type Filter = {
  q: string;
  status: '' | DocStatus;
  userEmail: string;
  mime: string;
};

export function DocumentsListClient() {
  const [filter, setFilter] = React.useState<Filter>({
    q: '',
    status: '',
    userEmail: '',
    mime: '',
  });
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [debouncedEmail, setDebouncedEmail] = React.useState('');
  const [debouncedMime, setDebouncedMime] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(filter.q.trim());
      setDebouncedEmail(filter.userEmail.trim());
      setDebouncedMime(filter.mime.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [filter.q, filter.userEmail, filter.mime]);

  const buildQuery = (cursorParam?: string) => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set('q', debouncedQ);
    if (filter.status) p.set('status', filter.status);
    if (debouncedEmail) p.set('userEmail', debouncedEmail);
    if (debouncedMime) p.set('mime', debouncedMime);
    if (cursorParam) p.set('cursor', cursorParam);
    p.set('limit', '50');
    return p.toString();
  };

  type Page = { documents: DocRow[]; nextCursor: string | null; total: number | null };
  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: qk.adminDocuments(
      debouncedQ,
      filter.status,
      debouncedEmail,
      debouncedMime,
    ),
    queryFn: ({ pageParam }) =>
      apiGet<Page>(`/api/admin/documents?${buildQuery(pageParam ?? undefined)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows = React.useMemo(
    () => data?.pages.flatMap((p) => p.documents) ?? [],
    [data],
  );
  const total = data?.pages[0]?.total ?? null;
  const loadMore = () => {
    if (hasNextPage && !loadingMore) void fetchNextPage();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          {total !== null && (
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {total.toLocaleString('vi-VN')} total
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400">
          Tài liệu cross-user. Click row để xem chunks + re-ingest khi FAILED, hoặc xoá.
        </p>
      </header>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={filter.q}
            onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
            placeholder="Tên file…"
            className="h-9 w-full rounded-md border border-slate-800 bg-slate-900 pl-8 pr-7 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
          />
          {filter.q && (
            <button
              onClick={() => setFilter((f) => ({ ...f, q: '' }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <input
          value={filter.userEmail}
          onChange={(e) => setFilter((f) => ({ ...f, userEmail: e.target.value }))}
          placeholder="Email owner…"
          className="h-9 w-44 rounded-md border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
        />
        <input
          value={filter.mime}
          onChange={(e) => setFilter((f) => ({ ...f, mime: e.target.value }))}
          placeholder="MIME (vd 'pdf')…"
          className="h-9 w-36 rounded-md border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
        />
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip
          active={filter.status === ''}
          onClick={() => setFilter((f) => ({ ...f, status: '' }))}
        >
          Mọi status
        </FilterChip>
        {(['READY', 'PROCESSING', 'FAILED', 'UPLOADING'] as const).map((s) => (
          <FilterChip
            key={s}
            active={filter.status === s}
            onClick={() => setFilter((f) => ({ ...f, status: s }))}
          >
            {s}
          </FilterChip>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
            <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2.5">File</th>
              <th className="px-3 py-2.5">Owner</th>
              <th className="px-3 py-2.5">Workspace</th>
              <th className="px-3 py-2.5">Size</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Uploaded</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-xs text-slate-500">
                  Không có document khớp filter.
                </td>
              </tr>
            ) : (
              rows.map((d) => <DocRowItem key={d.id} d={d} />)
            )}
          </tbody>
        </table>
      </div>

      {hasNextPage && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Tải thêm
          </button>
        </div>
      )}
    </div>
  );
}

function DocRowItem({ d }: { d: DocRow }) {
  return (
    <tr className="border-b border-slate-800/60 transition-colors hover:bg-slate-800/40">
      <td className="px-3 py-2">
        <Link href={`/admin/documents/${d.id}`} className="flex items-center gap-2 text-slate-100">
          <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span className="truncate text-[13px] font-medium">{d.filename}</span>
        </Link>
      </td>
      <td className="px-3 py-2">
        {d.userId ? (
          <Link
            href={`/admin/users/${d.userId}`}
            className="flex flex-col leading-tight transition-colors hover:text-slate-100"
          >
            <span className="truncate text-[12px] text-slate-300">{d.userName ?? '—'}</span>
            <span className="truncate font-mono text-[10.5px] text-slate-500">
              {d.userEmail ?? '—'}
            </span>
          </Link>
        ) : (
          <span className="text-[11px] text-slate-600">—</span>
        )}
      </td>
      <td className="px-3 py-2 truncate text-[12px] text-slate-400">{d.workspaceName ?? '—'}</td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-400">
        {formatSize(d.size)}
      </td>
      <td className="px-3 py-2">
        <StatusPill status={d.status} />
      </td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-500">
        {new Date(d.createdAt).toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
        })}
      </td>
      <td className="px-3 py-2 text-right">
        <Link
          href={`/admin/documents/${d.id}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          aria-label="Chi tiết"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: DocStatus }) {
  const cfg = {
    READY: { cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', icon: CircleCheck },
    PROCESSING: { cls: 'border-blue-500/30 bg-blue-500/10 text-blue-300', icon: RotateCw },
    UPLOADING: { cls: 'border-slate-500/30 bg-slate-500/10 text-slate-300', icon: RotateCw },
    FAILED: { cls: 'border-red-500/30 bg-red-500/10 text-red-300', icon: AlertCircle },
  }[status];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
        cfg.cls,
      )}
    >
      <Icon
        className={cn('h-2.5 w-2.5', status === 'PROCESSING' || status === 'UPLOADING' ? 'animate-spin' : '')}
      />
      {status}
    </span>
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
